// Admin dashboard: log in, list invoices, create invoices, share pay links, cancel invoices.
import express, { Router } from 'express';
import { pool } from '../db.js';
import { payUrl } from '../serializers.js';
import { validateInvoiceInput, createInvoice } from '../services/invoices.js';
import {
  verifyPassword, dummyVerify, startSession, endSession, requireAdmin, checkCsrf,
  loginBlocked, recordFailedLogin, clearFailedLogins,
} from '../auth.js';
import { loginPage, dashboardPage, newInvoicePage, invoiceDetailPage } from '../views/admin.js';
import { settingsRouter } from './settings.js';

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

// Everything below needs a logged-in admin, and every form POST needs the CSRF token
adminRouter.use(requireAdmin, checkCsrf);

adminRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.redirect(303, '/admin/login');
});

adminRouter.use('/settings', settingsRouter);

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
  const { rowCount } = await pool.query(
    `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
      WHERE public_id = $1 AND merchant_id = $2 AND status = 'open'`,
    [req.params.id, req.merchant.id]
  );
  if (rowCount) console.log(`Admin ${req.admin.email} cancelled invoice ${req.params.id}`);
  res.redirect(303, `/admin/invoices/${encodeURIComponent(req.params.id)}?notice=${rowCount ? 'cancelled' : 'cannot-cancel'}`);
});
