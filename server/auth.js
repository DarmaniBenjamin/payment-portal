// Admin passwords, login sessions and CSRF protection for the dashboard.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'pp_admin';
const SESSION_HOURS = 12;

// ---- Passwords (scrypt, stored as "scrypt$<salt>$<hash>") ----
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Used when the email doesn't exist, so a wrong email takes as long as a wrong password
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));
export const dummyVerify = (password) => verifyPassword(password, DUMMY_HASH);

// ---- Sessions ----
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const secureCookies = () => String(process.env.PUBLIC_URL || '').startsWith('https://');

function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function startSession(res, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  await pool.query('DELETE FROM admin_sessions WHERE expires_at < NOW()');
  await pool.query(
    `INSERT INTO admin_sessions (admin_id, token_hash, csrf_token, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(hours => $4))`,
    [adminId, sha256(token), csrf, SESSION_HOURS]
  );
  await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [adminId]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/admin',
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/admin' });
}

// Lets the request through only if it has a valid session; loads the admin and their business
export async function requireAdmin(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.redirect(303, '/admin/login');
  const { rows } = await pool.query(
    `SELECT s.csrf_token, a.id, a.name, a.email,
            m.id AS merchant_id, m.name AS merchant_name, m.currency, m.fee_structure, m.wipay_environment
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       JOIN merchants m ON m.id = a.merchant_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.is_active AND m.is_active`,
    [sha256(token)]
  );
  if (!rows.length) {
    res.clearCookie(COOKIE, { path: '/admin' });
    return res.redirect(303, '/admin/login');
  }
  const r = rows[0];
  req.admin = { id: r.id, name: r.name, email: r.email };
  req.merchant = { id: r.merchant_id, name: r.merchant_name, currency: r.currency, fee_structure: r.fee_structure, environment: r.wipay_environment };
  req.csrf = r.csrf_token;
  req.sessionTokenHash = sha256(token);
  next();
}

// After a password change: log out every other device, keep this one
export async function endOtherSessions(adminId, keepTokenHash) {
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [adminId, keepTokenHash]);
}

// Every form in the dashboard includes the session's CSRF token; reject POSTs without it
export function checkCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = Buffer.from(String(req.body?._csrf || ''));
  const expected = Buffer.from(req.csrf);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return res.status(403).type('text').send('This form expired. Go back, refresh the page and try again.');
  }
  next();
}

// ---- Login attempt limit: 10 tries per 15 minutes per IP address ----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;

export function loginBlocked(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > WINDOW_MS) return false;
  return a.count >= MAX_TRIES;
}
export function recordFailedLogin(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
}
export const clearFailedLogins = (ip) => attempts.delete(ip);
