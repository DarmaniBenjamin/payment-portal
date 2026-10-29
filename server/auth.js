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

// Lets the request through only if it has a valid session; loads the admin and their business.
// If a platform login has opened a client's account (support access), req.merchant is the client.
export async function requireAdmin(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.redirect(303, '/admin/login');
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.csrf_token, s.acting_merchant_id, s.acting_until > NOW() AS acting_valid,
            a.id, a.name, a.email,
            m.id AS merchant_id, m.name AS merchant_name, m.currency, m.fee_structure, m.wipay_environment, m.is_platform
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       JOIN merchants m ON m.id = a.merchant_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.is_active AND m.is_active AND a.password_hash IS NOT NULL`,
    [sha256(token)]
  );
  if (!rows.length) {
    res.clearCookie(COOKIE, { path: '/admin' });
    return res.redirect(303, '/admin/login');
  }
  const r = rows[0];
  req.admin = { id: r.id, name: r.name, email: r.email };
  req.homeMerchant = { id: r.merchant_id, name: r.merchant_name, is_platform: r.is_platform };
  req.merchant = { id: r.merchant_id, name: r.merchant_name, currency: r.currency, fee_structure: r.fee_structure, environment: r.wipay_environment };
  req.csrf = r.csrf_token;
  req.sessionId = r.session_id;
  req.sessionTokenHash = sha256(token);
  req.support = null;

  if (r.acting_merchant_id && r.is_platform) {
    const { rows: [client] } = r.acting_valid
      ? await pool.query('SELECT id, name, currency, fee_structure, wipay_environment FROM merchants WHERE id = $1 AND NOT is_platform', [r.acting_merchant_id])
      : { rows: [] };
    if (client) {
      req.merchant = { id: client.id, name: client.name, currency: client.currency, fee_structure: client.fee_structure, environment: client.wipay_environment };
      req.support = { merchantId: client.id, merchantName: client.name };
    } else {
      // Support access ran out (1 hour): back to the platform's own account
      await pool.query('UPDATE admin_sessions SET acting_merchant_id = NULL, acting_until = NULL WHERE id = $1', [r.session_id]);
    }
  }
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

// ---- One-time links for invites and password resets ----
export async function createAdminToken(adminId, purpose, hours) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query("DELETE FROM admin_tokens WHERE admin_id = $1 AND purpose = $2 AND used_at IS NULL", [adminId, purpose]);
  await pool.query(
    'INSERT INTO admin_tokens (admin_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + make_interval(hours => $4))',
    [adminId, purpose, sha256(token), hours]
  );
  return token;
}

// Returns the admin a valid, unused link belongs to (or null). Does not use it up.
export async function findAdminToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT t.id AS token_id, t.purpose, a.id, a.name, a.email
       FROM admin_tokens t JOIN admins a ON a.id = t.admin_id JOIN merchants m ON m.id = a.merchant_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > NOW() AND a.is_active AND m.is_active`,
    [sha256(token)]
  );
  return rows[0] || null;
}

// Sets the password from a link, uses up all of that admin's links, and logs out their other devices
export async function setPasswordFromToken(tokenRow, password) {
  await pool.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [tokenRow.id, await hashPassword(password)]);
  await pool.query('UPDATE admin_tokens SET used_at = NOW() WHERE admin_id = $1 AND used_at IS NULL', [tokenRow.id]);
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = $1', [tokenRow.id]);
}

// Simple password rules shared by every place a password is chosen. Returns an error or null.
export function passwordProblem(pw, confirm) {
  pw = String(pw || '');
  if (pw.length < 12) return 'The password must be at least 12 characters.';
  if (pw.length > 200) return 'The password is too long.';
  if (pw !== String(confirm || '')) return 'The two passwords don\u2019t match.';
  return null;
}
