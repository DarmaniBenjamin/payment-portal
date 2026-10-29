// Admin dashboard: log in, list invoices, create invoices, share pay links, cancel invoices.
import express, { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { payUrl } from '../serializers.js';
import { validateInvoiceInput, createInvoice } from '../services/invoices.js';
import {
  verifyPassword, dummyVerify, startSession, endSession, requireAdmin, checkCsrf,
  loginBlocked, recordFailedLogin, clearFailedLogins,
  createAdminToken, findAdminToken, setPasswordFromToken, passwordProblem, hashPassword,
} from '../auth.js';
import { queueEmail } from '../mailer.js';
import { logAccess } from '../services/access.js';
import { loginPage, dashboardPage, newInvoicePage, invoiceDetailPage, messagePage } from '../views/admin.js';
import { forgotPage, forgotSentPage, setPasswordPage, linkInvalidPage, setupPage, setupClosedPage } from '../views/account.js';
import { settingsRouter } from './settings.js';
import { platformRouter } from './platform.js';

export const adminRouter = Router();

adminRouter.use(express.urlencoded({ extended: false, limit: '20kb' }));
adminRouter.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  next();
});

const html = (res, body, status = 200) => res.status(status).type('html').send(body);

// ---- Login / logout ----
adminRouter.get('/login', (req, res) => html(res, loginPage()));

adminRouter.post('/login', async (req, res) => {
  const ip = req.ip;
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');

  if (loginBlocked(ip)) {
    return html(res, loginPage({ error: 'Too many attempts. Wait 15 minutes and try again.', email }), 429);
  }

  const { rows } = await pool.query(
    `SELECT a.id, a.password_hash FROM admins a JOIN merchants m ON m.id = a.merchant_id
      WHERE LOWER(a.email) = LOWER($1) AND a.is_active AND m.is_active`,
    [email]
  );
  const ok = rows.length ? await verifyPassword(password, rows[0].password_hash) : await dummyVerify(password);
  if (!ok) {
    recordFailedLogin(ip);
    console.warn(`Admin login failed for "${email}" from ${ip}`);
    return html(res, loginPage({ error: 'Wrong email or password.', email }), 401);
  }

  clearFailedLogins(ip);
  await startSession(res, rows[0].id);
  res.redirect(303, '/admin');
});

// ---- Forgot password / set password from an emailed link ----
adminRouter.get('/forgot', (req, res) => html(res, forgotPage()));

adminRouter.post('/forgot', async (req, res) => {
  const ip = req.ip;
  const email = String(req.body.email || '').trim();
  if (loginBlocked(ip)) return html(res, forgotPage({ error: 'Too many attempts. Wait 15 minutes and try again.', email }), 429);
  recordFailedLogin(ip); // counts toward the same limit, so this can't be used to spam people
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.email FROM admins a JOIN merchants m ON m.id = a.merchant_id
      WHERE LOWER(a.email) = LOWER($1) AND a.is_active AND m.is_active AND a.password_hash IS NOT NULL`,
    [email]
  );
  if (rows.length) {
    const token = await createAdminToken(rows[0].id, 'reset', 1);
    const base = process.env.PUBLIC_URL.replace(/\/$/, '');
    await queueEmail({
      to: rows[0].email,
      subject: 'Choose a new password for your payment portal',
      body: `Hi ${rows[0].name},\n\nSomeone (hopefully you) asked to reset your payment portal password.\n\nChoose a new password here (the link works once and expires in 1 hour):\n${base}/admin/set-password?token=${token}\n\nIf you didn't ask for this, ignore this email; your password stays the same.`,
    });
  }
  // Same answer whether or not the email has a login, so this can't be used to find accounts
  html(res, forgotSentPage());
});

adminRouter.get('/set-password', async (req, res) => {
  const who = await findAdminToken(req.query.token);
  if (!who) return html(res, linkInvalidPage(), 410);
  html(res, setPasswordPage({ token: req.query.token, who, purpose: who.purpose }));
});

adminRouter.post('/set-password', async (req, res) => {
  const who = await findAdminToken(req.body.token);
  if (!who) return html(res, linkInvalidPage(), 410);
  const problem = passwordProblem(req.body.password, req.body.confirm);
  if (problem) return html(res, setPasswordPage({ token: req.body.token, who, purpose: who.purpose, error: problem }), 400);
  await setPasswordFromToken(who, req.body.password);
  console.log(`${who.email} set a password (${who.purpose})`);
  await startSession(res, who.id);
  res.redirect(303, '/admin');
});

// ---- First-time setup on a new server ----
// Only works while there are no logins at all, and only with the SETUP_TOKEN from the server's settings.
async function setupBlocked(token) {
  const expected = process.env.SETUP_TOKEN || '';
  if (expected.length < 24) return 'Setup is switched off. To use it, set a SETUP_TOKEN of at least 24 characters in the server settings.';
  const a = Buffer.from(String(token || '')), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'This setup link is not valid.';
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM admins');
  if (n > 0) return 'Setup is already done. Log in instead, and remove SETUP_TOKEN from the server settings.';
  return null;
}

adminRouter.get('/setup', async (req, res) => {
  const blocked = await setupBlocked(req.query.token);
  if (blocked) return html(res, setupClosedPage(blocked), 404);
  html(res, setupPage({ token: req.query.token }));
});

adminRouter.post('/setup', async (req, res) => {
  const f = req.body;
  if (loginBlocked(req.ip)) return html(res, setupClosedPage('Too many attempts. Wait 15 minutes and try again.'), 429);
  const blocked = await setupBlocked(f.token);
  if (blocked) {
    recordFailedLogin(req.ip);
    return html(res, setupClosedPage(blocked), 404);
  }
  const t = (k) => (typeof f[k] === 'string' ? f[k].trim() : '');
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fail = (error) => html(res, setupPage({ token: f.token, values: f, error }), 400);
  if (!t('business_name') || t('business_name').length > 80) return fail('Enter the platform business name.');
  if (!EMAIL.test(t('business_email'))) return fail('Enter a valid business email.');
  if (!t('name') || t('name').length > 60) return fail('Enter your name.');
  if (!EMAIL.test(t('email'))) return fail('Enter a valid login email.');
  const problem = passwordProblem(f.password, f.confirm);
  if (problem) return fail(problem);

  const client = await pool.connect();
  let adminId;
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE admins IN EXCLUSIVE MODE'); // two setup clicks at once can't both win
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM admins');
    if (n > 0) {
      await client.query('ROLLBACK');
      return html(res, setupClosedPage('Setup is already done. Log in instead.'), 404);
    }
    await client.query('UPDATE merchants SET is_platform = FALSE WHERE is_platform');
    const { rows: [m] } = await client.query(
      'INSERT INTO merchants (name, email, is_platform) VALUES ($1, $2, TRUE) RETURNING id',
      [t('business_name'), t('business_email')]
    );
    ({ rows: [{ id: adminId }] } = await client.query(
      'INSERT INTO admins (merchant_id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [m.id, t('name'), t('email'), await hashPassword(f.password)]
    ));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`First-time setup done: platform "${t('business_name')}", login ${t('email')}. Remove SETUP_TOKEN now.`);
  await startSession(res, adminId);
  res.redirect(303, '/admin');
});

// Everything below needs a logged-in admin, and every form POST needs the CSRF token
adminRouter.use(requireAdmin, checkCsrf);

// While a platform login is inside a client's account: block changing the client's own
// password, and record every successful change in the client's access history.
// [path, description, needs a detail from the handler (no detail = nothing actually changed)]
const AUDIT = [
  [/^\/invoices$/, (d) => `Created invoice ${d}`, true],
  [/^\/invoices\/[^/]+\/cancel$/, (d) => `Cancelled invoice ${d}`, true],
  [/^\/settings\/payments$/, () => 'Changed WiPay payment settings', false],
  [/^\/settings\/business$/, () => 'Changed business details', false],
  [/^\/settings\/sites$/, (d) => `Connected a new site: ${d}`, true],
  [/^\/settings\/sites\/\d+\/webhook$/, (d) => `Changed the webhook URL for ${d}`, true],
  [/^\/settings\/sites\/\d+\/toggle$/, (d) => `Turned ${d}`, true],
  [/^\/settings\/sites\/\d+\/rotate$/, (d) => `Replaced the API key for ${d}`, true],
];

adminRouter.use((req, res, next) => {
  if (!req.support || req.method !== 'POST') return next();
  if (req.path === '/settings/password') {
    return html(res, messagePage(req, 'Not allowed', 'The client\u2019s own password can only be changed by them.'), 403);
  }
  if (req.path === '/support/exit' || req.path === '/logout') return next();
  const path = req.path; // read now: sub-routers change req.path while handling the request
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const rule = AUDIT.find(([re]) => re.test(path));
    const detail = res.locals.auditDetail;
    if (rule && rule[2] && !detail) return;
    const action = rule ? rule[1](detail) : `Made a change (${path})`;
    logAccess({ merchantId: req.support.merchantId, actor: req.admin, action, ip: req.ip })
      .catch((err) => console.error('Could not write access log:', err.message));
  });
  next();
});

async function leaveSupport(req) {
  if (!req.support) return;
  await pool.query('UPDATE admin_sessions SET acting_merchant_id = NULL, acting_until = NULL WHERE id = $1', [req.sessionId]);
  await logAccess({ merchantId: req.support.merchantId, actor: req.admin, action: 'Left the account', ip: req.ip });
}

adminRouter.post('/support/exit', async (req, res) => {
  const id = req.support?.merchantId;
  await leaveSupport(req);
  res.redirect(303, id ? `/admin/platform/businesses/${id}` : '/admin');
});

adminRouter.post('/logout', async (req, res) => {
  await leaveSupport(req);
  await endSession(req, res);
  res.redirect(303, '/admin/login');
});

adminRouter.use('/settings', settingsRouter);
adminRouter.use('/platform', platformRouter);

// ---- Invoices list ----
const PAGE_SIZE = 50;
const STATUSES = new Set(['open', 'paid', 'cancelled']);

adminRouter.get('/', async (req, res) => {
  const status = STATUSES.has(req.query.status) ? req.query.status : 'all';
  const q = String(req.query.q || '').trim().slice(0, 100);
  const pageNo = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));

  const where = ['i.merchant_id = $1'];
  const params = [req.merchant.id];
  if (status !== 'all') {
    params.push(status);
    where.push(`i.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const n = params.length;
    where.push(`(i.number ILIKE $${n} OR i.description ILIKE $${n} OR c.name ILIKE $${n} OR c.email ILIKE $${n})`);
  }
  params.push(PAGE_SIZE + 1, (pageNo - 1) * PAGE_SIZE);

  const { rows } = await pool.query(
    `SELECT i.public_id, i.number, i.description, i.amount, i.currency, i.status, i.due_date, i.paid_at, i.created_at,
            c.name AS customer_name
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: [totals] } = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'open'), 0) AS open_total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Grenada') AT TIME ZONE 'America/Grenada'), 0) AS paid_month_total,
            COUNT(*) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Grenada') AT TIME ZONE 'America/Grenada')::int AS paid_month_count
       FROM invoices WHERE merchant_id = $1`,
    [req.merchant.id]
  );

  html(res, dashboardPage(req, {
    invoices: rows.slice(0, PAGE_SIZE),
    totals,
    status,
    q,
    pageNo,
    hasMore: rows.length > PAGE_SIZE,
  }));
});

// ---- New invoice ----
adminRouter.get('/invoices/new', (req, res) => html(res, newInvoicePage(req)));

adminRouter.post('/invoices', async (req, res) => {
  const f = req.body;
  const clean = (k) => (typeof f[k] === 'string' && f[k].trim() !== '' ? f[k].trim() : undefined);
  const input = {
    amount: clean('amount')?.replace(/[,$\s]|EC/gi, '') ?? '',
    description: clean('description') ?? '',
    due_date: clean('due_date'),
    customer: { name: clean('customer_name'), email: clean('customer_email') ?? '', phone: clean('customer_phone') },
  };

  const error = validateInvoiceInput(input);
  if (error) {
    // Show the API-style message in plain words, and keep what they typed
    const friendly = error.replace(/^customer\./, 'Customer ').replace(/^amount/, 'Amount').replace(/^description/, 'Description').replace(/^due_date/, 'Due date');
    return html(res, newInvoicePage(req, { values: f, error: friendly }), 400);
  }

  const invoice = await createInvoice({ merchantId: req.merchant.id, currency: req.merchant.currency, input });
  res.locals.auditDetail = invoice.number;
  console.log(`Admin ${req.admin.email} created invoice ${invoice.number}`);
  res.redirect(303, `/admin/invoices/${invoice.public_id}?notice=created`);
});

// ---- Invoice detail ----
async function loadInvoice(merchantId, publicId) {
  const { rows } = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, s.name AS site_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN sites s ON s.id = i.site_id
      WHERE i.public_id = $1 AND i.merchant_id = $2`,
    [publicId, merchantId]
  );
  return rows[0];
}

adminRouter.get('/invoices/:id', async (req, res) => {
  const inv = await loadInvoice(req.merchant.id, req.params.id);
  if (!inv) return res.redirect(303, '/admin');
  const { rows: payments } = await pool.query(
    `SELECT status, amount, currency, created_at,
            COALESCE(gateway_response->>'message', gateway_response->>'error') AS message
       FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [inv.id]
  );
  const notice = ['created', 'cancelled', 'cannot-cancel'].includes(req.query.notice) ? req.query.notice : undefined;
  html(res, invoiceDetailPage(req, { inv, payments, payUrl: payUrl(inv.public_id), notice }));
});

adminRouter.post('/invoices/:id/cancel', async (req, res) => {
  const { rowCount, rows } = await pool.query(
    `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
      WHERE public_id = $1 AND merchant_id = $2 AND status = 'open' RETURNING number`,
    [req.params.id, req.merchant.id]
  );
  if (rowCount) res.locals.auditDetail = rows[0].number;
  if (rowCount) console.log(`Admin ${req.admin.email} cancelled invoice ${req.params.id}`);
  res.redirect(303, `/admin/invoices/${encodeURIComponent(req.params.id)}?notice=${rowCount ? 'cancelled' : 'cannot-cancel'}`);
});
