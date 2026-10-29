// Settings: business details, WiPay payments, connected sites, password.
// Mounted inside the admin router, so every route already needs a login and a CSRF token.
import { Router } from 'express';
import { pool } from '../db.js';
import { encrypt, generateApiKey, randomSecret } from '../crypto.js';
import { verifyPassword, hashPassword, endOtherSessions } from '../auth.js';
import { checkWebhookUrl, checkSiteUrl, SITE_TYPES } from '../services/sites.js';
import { settingsPage, siteKeyPage } from '../views/settings.js';

export const settingsRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const html = (res, body, status = 200) => res.status(status).type('html').send(body);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

async function loadMerchant(id) {
  const { rows } = await pool.query('SELECT * FROM merchants WHERE id = $1', [id]);
  return rows[0];
}

async function loadSites(merchantId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.type, s.url, s.api_key_prefix, s.webhook_url, s.is_active,
            d.status AS last_status, d.last_error, COALESCE(d.delivered_at, d.created_at) AS last_at
       FROM sites s
       LEFT JOIN LATERAL (
         SELECT status, last_error, delivered_at, created_at FROM webhook_deliveries
          WHERE site_id = s.id ORDER BY created_at DESC LIMIT 1
       ) d ON TRUE
      WHERE s.merchant_id = $1
      ORDER BY s.created_at`,
    [merchantId]
  );
  return rows;
}

// Shows the settings page again with one form's error (and what they typed)
async function showWithError(req, res, section, message, typed = {}) {
  const [m, sites] = await Promise.all([loadMerchant(req.merchant.id), loadSites(req.merchant.id)]);
  html(res, settingsPage(req, { m, sites, errors: { [section]: message }, values: { [section]: typed } }), 400);
}

const done = (res, notice, anchor) => res.redirect(303, `/admin/settings?notice=${notice}#${anchor}`);

async function passwordOk(adminId, password) {
  const { rows } = await pool.query('SELECT password_hash FROM admins WHERE id = $1', [adminId]);
  return rows.length > 0 && verifyPassword(String(password || ''), rows[0].password_hash);
}

settingsRouter.get('/', async (req, res) => {
  const [m, sites] = await Promise.all([loadMerchant(req.merchant.id), loadSites(req.merchant.id)]);
  html(res, settingsPage(req, { m, sites, notice: typeof req.query.notice === 'string' ? req.query.notice : undefined }));
});

// ---- Business ----
settingsRouter.post('/business', async (req, res) => {
  const name = text(req.body.name);
  const email = text(req.body.email);
  if (!name || name.length > 80) return showWithError(req, res, 'business', 'Business name is required (max 80 characters).', req.body);
  if (!EMAIL_RE.test(email) || email.length > 80) return showWithError(req, res, 'business', 'Business email must be a valid email.', req.body);
  await pool.query('UPDATE merchants SET name = $2, email = $3, updated_at = NOW() WHERE id = $1', [req.merchant.id, name, email]);
  console.log(`Admin ${req.admin.email} updated business details`);
  done(res, 'business', 'business');
});

// ---- Payments (needs current password) ----
settingsRouter.post('/payments', async (req, res) => {
  const b = req.body;
  const typed = { ...b, wipay_api_key: undefined, current_password: undefined };
  const account = text(b.wipay_account_number);
  const apiKey = text(b.wipay_api_key);
  const environment = b.wipay_environment;
  const fee = b.fee_structure;
  const currency = b.currency;

  if (!(await passwordOk(req.admin.id, b.current_password))) {
    console.warn(`Admin ${req.admin.email}: wrong password when changing payment settings`);
    return showWithError(req, res, 'payments', 'Your current password is wrong. Nothing was changed.', typed);
  }
  if (!['sandbox', 'live'].includes(environment)) return showWithError(req, res, 'payments', 'Choose test mode or live.', typed);
  if (!['customer_pay', 'split', 'merchant_absorb'].includes(fee)) return showWithError(req, res, 'payments', 'Choose who pays the card fee.', typed);
  if (!['XCD', 'USD'].includes(currency)) return showWithError(req, res, 'payments', 'Choose a currency.', typed);
  if (account && !/^\d{4,20}$/.test(account)) return showWithError(req, res, 'payments', 'The WiPay account number should be digits only.', typed);
  if (apiKey.length > 200) return showWithError(req, res, 'payments', 'That API key looks too long.', typed);

  const m = await loadMerchant(req.merchant.id);
  const willHaveKey = Boolean(apiKey || m.wipay_api_key_enc);
  if (environment === 'live' && (!account || !willHaveKey)) {
    return showWithError(req, res, 'payments', 'To go live, enter your WiPay account number and API key.', typed);
  }
  if (account && !willHaveKey) {
    return showWithError(req, res, 'payments', 'Enter the WiPay API key that goes with this account number.', typed);
  }

  await pool.query(
    `UPDATE merchants
        SET wipay_account_number = $2,
            wipay_api_key_enc = CASE WHEN $2::text IS NULL THEN NULL ELSE COALESCE($3, wipay_api_key_enc) END,
            wipay_environment = $4, fee_structure = $5, currency = $6, updated_at = NOW()
      WHERE id = $1`,
    [req.merchant.id, account || null, apiKey ? encrypt(apiKey) : null, environment, fee, currency]
  );
  console.log(`Admin ${req.admin.email} updated payment settings (${environment}${apiKey ? ', new API key' : ''})`);
  done(res, 'payments', 'payments');
});

// ---- Connected sites ----
async function ownSite(merchantId, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1 AND merchant_id = $2', [Number(id), merchantId]);
  return rows[0] || null;
}

settingsRouter.post('/sites', async (req, res) => {
  const name = text(req.body.name);
  const type = req.body.type;
  if (!name || name.length > 60) return showWithError(req, res, 'newsite', 'Site name is required (max 60 characters).', req.body);
  if (!SITE_TYPES.includes(type)) return showWithError(req, res, 'newsite', 'Choose a site type.', req.body);
  const site = checkSiteUrl(req.body.url);
  if (site.error) return showWithError(req, res, 'newsite', site.error, req.body);
  const hook = checkWebhookUrl(req.body.webhook_url);
  if (hook.error) return showWithError(req, res, 'newsite', hook.error, req.body);

  const { key, prefix, hash } = generateApiKey();
  const webhookSecret = randomSecret();
  const { rows: [created] } = await pool.query(
    `INSERT INTO sites (merchant_id, name, type, url, api_key_prefix, api_key_hash, webhook_url, webhook_secret_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name`,
    [req.merchant.id, name, type, site.url, prefix, hash, hook.url, encrypt(webhookSecret)]
  );
  console.log(`Admin ${req.admin.email} connected site "${name}" (id ${created.id})`);
  // Shown once, straight from this response; nothing is stored that could show it again
  html(res, siteKeyPage(req, { site: created, apiKey: key, webhookSecret }));
});

settingsRouter.post('/sites/:id/webhook', async (req, res) => {
  const s = await ownSite(req.merchant.id, req.params.id);
  if (!s) return res.redirect(303, '/admin/settings#sites');
  const hook = checkWebhookUrl(req.body.webhook_url);
  if (hook.error) return showWithError(req, res, `site${s.id}`, hook.error, req.body);
  await pool.query('UPDATE sites SET webhook_url = $2 WHERE id = $1', [s.id, hook.url]);
  done(res, 'site-webhook', 'sites');
});

settingsRouter.post('/sites/:id/toggle', async (req, res) => {
  const s = await ownSite(req.merchant.id, req.params.id);
  if (!s) return res.redirect(303, '/admin/settings#sites');
  await pool.query('UPDATE sites SET is_active = NOT is_active WHERE id = $1', [s.id]);
  console.log(`Admin ${req.admin.email} turned ${s.is_active ? 'off' : 'on'} site "${s.name}"`);
  done(res, s.is_active ? 'site-off' : 'site-on', 'sites');
});

settingsRouter.post('/sites/:id/rotate', async (req, res) => {
  const s = await ownSite(req.merchant.id, req.params.id);
  if (!s) return res.redirect(303, '/admin/settings#sites');
  const { key, prefix, hash } = generateApiKey();
  await pool.query('UPDATE sites SET api_key_prefix = $2, api_key_hash = $3 WHERE id = $1', [s.id, prefix, hash]);
  console.log(`Admin ${req.admin.email} replaced the API key for site "${s.name}"`);
  html(res, siteKeyPage(req, { site: s, apiKey: key, replaced: true }));
});

// ---- Password ----
settingsRouter.post('/password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (!(await passwordOk(req.admin.id, current_password))) {
    return showWithError(req, res, 'password', 'Your current password is wrong.');
  }
  const pw = String(new_password || '');
  if (pw.length < 12) return showWithError(req, res, 'password', 'The new password must be at least 12 characters.');
  if (pw.length > 200) return showWithError(req, res, 'password', 'The new password is too long.');
  if (pw !== String(confirm_password || '')) return showWithError(req, res, 'password', 'The two new passwords don’t match.');
  if (pw === String(current_password)) return showWithError(req, res, 'password', 'Choose a password different from your current one.');

  await pool.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [req.admin.id, await hashPassword(pw)]);
  await endOtherSessions(req.admin.id, req.sessionTokenHash);
  console.log(`Admin ${req.admin.email} changed their password`);
  done(res, 'password', 'password');
});
