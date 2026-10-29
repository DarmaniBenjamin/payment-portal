// HTML for the Settings pages: business details, WiPay payments, connected sites, password.
import { esc } from './payPage.js';
import { shell, badge, fmtDateTime } from './admin.js';

const NOTICES = {
  business: ['ok', 'Business details saved.'],
  payments: ['ok', 'Payment settings saved.'],
  'site-webhook': ['ok', 'Webhook URL saved.'],
  'site-on': ['ok', 'Site turned on. It can create invoices again.'],
  'site-off': ['warn', 'Site turned off. Its API key no longer works until you turn it back on.'],
  password: ['ok', 'Password changed. Any other devices were logged out.'],
};

const FEES = [
  ['customer_pay', 'Customer pays the fee', 'The card fee is added to the customer’s total. You receive the full invoice amount.'],
  ['split', 'Split the fee', 'Half the fee is added to the customer’s total, half comes out of what you receive.'],
  ['merchant_absorb', 'I pay the fee', 'The customer pays exactly the invoice amount. The fee comes out of what you receive.'],
];

const TYPES = { wordpress: 'WordPress', static: 'Website (static)', app: 'App / other' };

// errors: { section: message } so each form shows its own error
export function settingsPage(ctx, { m, sites, access = [], notice, errors = {}, values = {} }) {
  const n = NOTICES[notice];
  const err = (section) => (errors[section] ? `<div class="alert bad" role="alert">${esc(errors[section])}</div>` : '');
  const csrf = `<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`;
  const val = (section, key, fallback) => esc(values[section]?.[key] ?? fallback ?? '');

  const siteRows = sites.length
    ? sites.map((s) => {
        const last = s.last_status
          ? `${badge(s.last_status === 'delivered' ? 'success' : s.last_status === 'failed' ? 'failed' : 'pending')} <span>${esc(s.last_status === 'pending' ? `retrying (${s.last_error || 'waiting'})` : s.last_status === 'failed' ? `gave up: ${s.last_error || ''}` : 'last notification delivered')} &middot; ${esc(fmtDateTime(s.last_at))}</span>`
          : 'No notifications sent yet';
        return `<div class="site">
<div class="site-head"><div><div class="site-name">${esc(s.name)} ${s.is_active ? '' : badge('cancelled').replace('Cancelled', 'Off')}</div>
<div class="site-meta">${esc(TYPES[s.type] || s.type)}${s.url ? ` &middot; ${esc(s.url)}` : ''} &middot; key <code>${esc(s.api_key_prefix)}&hellip;</code></div>
<div class="site-meta">${last}</div></div></div>
<div class="site-actions">
<form method="post" action="/admin/settings/sites/${s.id}/webhook">${csrf}
<input name="webhook_url" value="${val(`site${s.id}`, 'webhook_url', s.webhook_url)}" placeholder="Webhook URL (https://...)" aria-label="Webhook URL for ${esc(s.name)}">
<button class="btn ghost" type="submit">Save</button></form>
<form method="post" action="/admin/settings/sites/${s.id}/toggle" style="flex:0 0 auto">${csrf}<button class="btn ghost" type="submit">${s.is_active ? 'Turn off' : 'Turn on'}</button></form>
<form method="post" action="/admin/settings/sites/${s.id}/rotate" style="flex:0 0 auto" onsubmit="return confirm('Replace the API key for ${esc(s.name)}? The old key stops working immediately, so you will need to paste the new one into that site.')">${csrf}<button class="btn danger" type="submit">New API key</button></form>
</div>${err(`site${s.id}`)}</div>`;
      }).join('')
    : '<p class="small muted">No sites connected yet.</p>';

  const keySaved = Boolean(m.wipay_api_key_enc);

  return shell('Settings', ctx, 'settings', `
<h1>Settings</h1>
${n ? `<div class="alert ${n[0]}" role="status">${esc(n[1])}</div>` : ''}
<div class="settings">

<section class="card" id="payments">
<h2>Payments (WiPay)</h2>
<p class="lead">Where card payments go. Changes here need ${ctx.support ? 'your own (staff) password, and the client is emailed' : 'your current password'}.</p>
${err('payments')}
<form method="post" action="/admin/settings/payments">${csrf}
<div class="row2">
<div class="field"><label for="wipay_account_number">WiPay account number</label>
<input id="wipay_account_number" name="wipay_account_number" inputmode="numeric" value="${val('payments', 'wipay_account_number', m.wipay_account_number)}" placeholder="From your WiPay merchant account">
<div class="hint">${m.wipay_account_number ? '' : 'Leave empty in test mode to use WiPay’s public test account.'}</div></div>
<div class="field"><label for="wipay_api_key">WiPay API key</label>
<input id="wipay_api_key" name="wipay_api_key" type="password" autocomplete="off" placeholder="${keySaved ? 'Saved (leave empty to keep it)' : 'From your WiPay merchant account'}">
<div class="hint">Stored encrypted. It is never shown again after saving.</div></div>
</div>
<div class="row2">
<div class="field"><label for="wipay_environment">Mode</label>
<select id="wipay_environment" name="wipay_environment">
<option value="sandbox" ${(values.payments?.wipay_environment ?? m.wipay_environment) === 'sandbox' ? 'selected' : ''}>Test mode (sandbox), no real money</option>
<option value="live" ${(values.payments?.wipay_environment ?? m.wipay_environment) === 'live' ? 'selected' : ''}>Live, real card payments</option>
</select></div>
<div class="field"><label for="currency">Currency</label>
<select id="currency" name="currency">
<option value="XCD" ${(values.payments?.currency ?? m.currency) === 'XCD' ? 'selected' : ''}>EC$ (XCD)</option>
<option value="USD" ${(values.payments?.currency ?? m.currency) === 'USD' ? 'selected' : ''}>US$ (USD)</option>
</select><div class="hint">Applies to new invoices only. Check with WiPay which currencies your account accepts.</div></div>
</div>
<div class="field"><label>Card processing fee</label><div class="radio">
${FEES.map(([v, label, help]) => `<label><input type="radio" name="fee_structure" value="${v}" ${(values.payments?.fee_structure ?? m.fee_structure) === v ? 'checked' : ''}><span>${esc(label)}<small>${esc(help)}</small></span></label>`).join('')}
</div></div>
<div class="field"><label for="pay_password">Your current password</label>
<input id="pay_password" name="current_password" type="password" autocomplete="current-password" required></div>
<button class="btn" type="submit">Save payment settings</button>
</form></section>

<section class="card" id="sites">
<h2>Connected sites</h2>
<p class="lead">Websites and apps that create invoices through the API, like a WordPress shop.</p>
${siteRows}
<details ${errors.newsite ? 'open' : ''} style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">+ Connect a new site</summary>
<div style="margin-top:12px">${err('newsite')}
<form method="post" action="/admin/settings/sites">${csrf}
<div class="row2">
<div class="field"><label for="site_name">Site name</label><input id="site_name" name="name" maxlength="60" required value="${val('newsite', 'name')}" placeholder="e.g. Protonic website"></div>
<div class="field"><label for="site_type">Type</label><select id="site_type" name="type">
${Object.entries(TYPES).map(([v, l]) => `<option value="${v}" ${values.newsite?.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
</div>
<div class="field"><label for="site_url">Site address</label><input id="site_url" name="url" value="${val('newsite', 'url')}" placeholder="https://example.com (optional)"></div>
<div class="field"><label for="site_webhook">Webhook URL</label><input id="site_webhook" name="webhook_url" value="${val('newsite', 'webhook_url')}" placeholder="https://... (optional, can be added later)">
<div class="hint">Where we notify the site when an invoice is paid.</div></div>
<button class="btn" type="submit">Create site and show its API key</button>
</form></div></details>
</section>

<section class="card" id="business">
<h2>Business</h2>
<p class="lead">Shown to customers on their invoice and pay page.</p>
${err('business')}
<form method="post" action="/admin/settings/business">${csrf}
<div class="row2">
<div class="field"><label for="biz_name">Business name</label><input id="biz_name" name="name" maxlength="80" required value="${val('business', 'name', m.name)}"></div>
<div class="field"><label for="biz_email">Business email</label><input id="biz_email" name="email" type="email" maxlength="80" required value="${val('business', 'email', m.email)}"></div>
</div>
<button class="btn" type="submit">Save business details</button>
</form></section>

<section class="card" id="access">
<h2>Access history</h2>
<p class="lead">Every time the platform team opened or changed this account. This list can’t be edited or deleted by anyone.</p>
${access.length ? `<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${access.map((a) => `<tr>
<td class="small" style="white-space:nowrap">${esc(fmtDateTime(a.created_at))}</td>
<td class="small">${esc(a.actor_name)}<div class="muted">${esc(a.actor_email)}</div></td>
<td class="small">${esc(a.action)}${a.reason ? `<div class="muted">Reason: ${esc(a.reason)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
  : '<p class="small muted" style="margin:0">No access by the platform team yet.</p>'}
</section>

${ctx.support ? '' : `<section class="card" id="password">
<h2>Your password</h2>
<p class="lead">Signed in as ${esc(ctx.admin.email)}. Changing it logs out your other devices.</p>
${err('password')}
<form method="post" action="/admin/settings/password">${csrf}
<input type="text" name="username" value="${esc(ctx.admin.email)}" autocomplete="username" hidden>
<div class="field"><label for="cur_pw">Current password</label><input id="cur_pw" name="current_password" type="password" autocomplete="current-password" required></div>
<div class="row2">
<div class="field"><label for="new_pw">New password</label><input id="new_pw" name="new_password" type="password" autocomplete="new-password" minlength="12" required><div class="hint">At least 12 characters</div></div>
<div class="field"><label for="new_pw2">Repeat new password</label><input id="new_pw2" name="confirm_password" type="password" autocomplete="new-password" minlength="12" required></div>
</div>
<button class="btn" type="submit">Change password</button>
</form></section>`}

</div>`);
}

// Shown once, right after creating a site or replacing its key
export function siteKeyPage(ctx, { site, apiKey, webhookSecret, replaced }) {
  return shell('Site API key', ctx, 'settings', `
<p class="small"><a href="/admin/settings#sites">&larr; Back to settings</a></p>
<div class="card" style="max-width:640px">
<h1 style="margin-bottom:6px">${replaced ? 'New API key' : 'Site connected'}: ${esc(site.name)}</h1>
<div class="alert warn" role="alert">Copy these now and keep them in your password manager. For your security they are <strong>never shown again</strong>.${replaced ? ' The old key has stopped working.' : ''}</div>
<label class="small" style="font-weight:600">API key</label>
<code class="key" id="k1">${esc(apiKey)}</code>
${webhookSecret ? `<label class="small" style="font-weight:600">Webhook secret</label><code class="key" id="k2">${esc(webhookSecret)}</code>` : ''}
<p class="small muted">Paste them into the site's settings (for example the WordPress plugin). The site uses the API key to create invoices${webhookSecret ? ', and the webhook secret to check that payment notifications really came from you' : ''}.</p>
<a class="btn" href="/admin/settings#sites">I've saved them</a>
</div>`);
}
