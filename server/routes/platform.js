// Platform area for the business that runs the service (Protonic):
// add client businesses, invite their logins, and open a client's account (always emailed and logged).
import { Router } from 'express';
import { pool } from '../db.js';
import { createAdminToken } from '../auth.js';
import { queueEmail } from '../mailer.js';
import { logAccess, recentAccess, notifyClient, nowText } from '../services/access.js';
import { businessesPage, newBusinessPage, businessPage } from '../views/platform.js';

export const platformRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_HOURS = 7 * 24;
const SUPPORT_MINUTES = 60;
const html = (res, body, status = 200) => res.status(status).type('html').send(body);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const base = () => process.env.PUBLIC_URL.replace(/\/$/, '');

// Only logins of the platform business, and not while inside a client's account
platformRouter.use((req, res, next) => {
  if (!req.homeMerchant.is_platform || req.support) return res.redirect(303, '/admin');
  next();
});

async function sendInvite(req, admin, businessName) {
  const token = await createAdminToken(admin.id, 'invite', INVITE_HOURS);
  await queueEmail({
    to: admin.email,
    subject: `Set up your ${businessName} payment portal login`,
    body: `Hi ${admin.name},\n\n${req.homeMerchant.name} has set up a payment portal account for ${businessName}, where you can see your invoices and payments.\n\nChoose your password here (the link works once and expires in 7 days):\n${base()}/admin/set-password?token=${token}\n\nAfter that, log in any time at ${base()}/admin\n\nOnly you will know your password. If you weren't expecting this email, you can ignore it.`,
  });
}

async function loadBusiness(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await pool.query(
    `SELECT m.*, (SELECT COUNT(*)::int FROM sites s WHERE s.merchant_id = m.id) AS sites
       FROM merchants m WHERE m.id = $1 AND NOT m.is_platform`,
    [Number(id)]
  );
  return rows[0] || null;
}

async function loadLogins(merchantId) {
  const { rows } = await pool.query(
    `SELECT id, name, email, password_hash IS NOT NULL AS has_password, last_login_at
       FROM admins WHERE merchant_id = $1 AND is_active ORDER BY created_at`,
    [merchantId]
  );
  return rows;
}

async function showBusiness(req, res, b, extra = {}) {
  const [logins, access] = await Promise.all([loadLogins(b.id), recentAccess(b.id)]);
  html(res, businessPage(req, { b, logins, access, ...extra }), extra.error ? 400 : 200);
}

// ---- List (setup details only, no money) ----
platformRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.name, m.email, m.wipay_environment, m.is_active, m.created_at,
            (SELECT COUNT(*)::int FROM sites s WHERE s.merchant_id = m.id) AS sites,
            (SELECT COUNT(*)::int FROM admins a WHERE a.merchant_id = m.id AND a.is_active AND a.password_hash IS NOT NULL) AS logins,
            (SELECT COUNT(*)::int FROM admins a WHERE a.merchant_id = m.id AND a.is_active AND a.password_hash IS NULL) AS pending
       FROM merchants m WHERE NOT m.is_platform ORDER BY LOWER(m.name)`
  );
  html(res, businessesPage(req, { businesses: rows }));
});

// ---- Add a business ----
platformRouter.get('/new', (req, res) => html(res, newBusinessPage(req)));

platformRouter.post('/businesses', async (req, res) => {
  const f = req.body;
  const name = text(f.name), email = text(f.email), ownerName = text(f.owner_name), ownerEmail = text(f.owner_email);
  const currency = f.currency === 'USD' ? 'USD' : 'XCD';
  const fail = (error) => html(res, newBusinessPage(req, { values: f, error }), 400);
  if (!name || name.length > 80) return fail('Business name is required (max 80 characters).');
  if (!EMAIL_RE.test(email) || email.length > 80) return fail('Business email must be a valid email.');
  if (!ownerName || ownerName.length > 60) return fail('Enter the name of the person who will log in.');
  if (!EMAIL_RE.test(ownerEmail) || ownerEmail.length > 80) return fail('Their email must be a valid email.');

  const client = await pool.connect();
  let merchant, owner;
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM merchants WHERE LOWER(name) = LOWER($1)', [name]);
    if (exists.rows.length) {
      await client.query('ROLLBACK');
      return fail('A business with that name already exists.');
    }
    ({ rows: [merchant] } = await client.query(
      'INSERT INTO merchants (name, email, currency) VALUES ($1, $2, $3) RETURNING id, name',
      [name, email, currency]
    ));
    ({ rows: [owner] } = await client.query(
      'INSERT INTO admins (merchant_id, name, email, password_hash) VALUES ($1, $2, $3, NULL) RETURNING id, name, email',
      [merchant.id, ownerName, ownerEmail]
    ));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return fail('That login email is already used by another account.');
    throw err;
  } finally {
    client.release();
  }

  await logAccess({ merchantId: merchant.id, actor: req.admin, action: `Created this account and invited ${owner.email}`, ip: req.ip });
  await sendInvite(req, owner, merchant.name);
  console.log(`Platform: ${req.admin.email} added business "${merchant.name}" and invited ${owner.email}`);
  res.redirect(303, `/admin/platform/businesses/${merchant.id}?notice=created`);
});

// ---- One business ----
platformRouter.get('/businesses/:id', async (req, res) => {
  const b = await loadBusiness(req.params.id);
  if (!b) return res.redirect(303, '/admin/platform');
  const notice = ['created', 'invited', 'resent'].includes(req.query.notice) ? req.query.notice : undefined;
  showBusiness(req, res, b, { notice });
});

platformRouter.post('/businesses/:id/logins', async (req, res) => {
  const b = await loadBusiness(req.params.id);
  if (!b) return res.redirect(303, '/admin/platform');
  const name = text(req.body.name), email = text(req.body.email);
  if (!name || name.length > 60 || !EMAIL_RE.test(email) || email.length > 80) {
    return showBusiness(req, res, b, { error: 'Enter a name and a valid email for the new login.' });
  }
  let admin;
  try {
    ({ rows: [admin] } = await pool.query(
      'INSERT INTO admins (merchant_id, name, email, password_hash) VALUES ($1, $2, $3, NULL) RETURNING id, name, email',
      [b.id, name, email]
    ));
  } catch (err) {
    if (err.code === '23505') return showBusiness(req, res, b, { error: 'That email is already used by another login.' });
    throw err;
  }
  await logAccess({ merchantId: b.id, actor: req.admin, action: `Invited a new login: ${admin.email}`, ip: req.ip });
  await sendInvite(req, admin, b.name);
  await notifyClient(b.id, `A new login was added to your ${b.name} account`,
    `${req.admin.name} (${req.homeMerchant.name}) invited ${admin.name} <${admin.email}> to log in to your ${b.name} payment portal account on ${nowText()}.\n\nIf you didn't ask for this, contact ${req.homeMerchant.name}.`);
  res.redirect(303, `/admin/platform/businesses/${b.id}?notice=invited`);
});

platformRouter.post('/businesses/:id/logins/:adminId/resend', async (req, res) => {
  const b = await loadBusiness(req.params.id);
  if (!b || !/^\d+$/.test(req.params.adminId)) return res.redirect(303, '/admin/platform');
  const { rows: [admin] } = await pool.query(
    'SELECT id, name, email FROM admins WHERE id = $1 AND merchant_id = $2 AND is_active AND password_hash IS NULL',
    [Number(req.params.adminId), b.id]
  );
  if (admin) {
    await sendInvite(req, admin, b.name);
    await logAccess({ merchantId: b.id, actor: req.admin, action: `Resent the invite to ${admin.email}`, ip: req.ip });
  }
  res.redirect(303, `/admin/platform/businesses/${b.id}?notice=resent`);
});

// ---- Open a client's account (support access) ----
platformRouter.post('/businesses/:id/open', async (req, res) => {
  const b = await loadBusiness(req.params.id);
  if (!b) return res.redirect(303, '/admin/platform');
  const reason = text(req.body.reason);
  if (reason.length < 5 || reason.length > 200) {
    return showBusiness(req, res, b, { error: 'Give a short reason (5 to 200 characters). The client will see it.' });
  }

  // Recorded and emailed BEFORE the account opens, so it can never happen silently
  await logAccess({ merchantId: b.id, actor: req.admin, action: 'Opened the account (support access)', reason, ip: req.ip });
  await notifyClient(b.id, `${req.homeMerchant.name} opened your ${b.name} account`,
    `${req.admin.name} <${req.admin.email}> from ${req.homeMerchant.name} opened your ${b.name} payment portal account on ${nowText()}.\n\nReason: ${reason}\n\nWhile inside, they can do what you can do. Every action is recorded in your access history. This access ends automatically after 1 hour.\n\nIf you didn't expect this, contact ${req.homeMerchant.name}.`);

  await pool.query(
    `UPDATE admin_sessions SET acting_merchant_id = $2, acting_until = NOW() + make_interval(mins => $3) WHERE id = $1`,
    [req.sessionId, b.id, SUPPORT_MINUTES]
  );
  console.log(`Platform: ${req.admin.email} opened "${b.name}" (${reason})`);
  res.redirect(303, '/admin');
});
