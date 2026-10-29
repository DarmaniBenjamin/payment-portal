// Platform area (Protonic): list client businesses, add one, manage its logins, open its account.
import { esc } from './payPage.js';
import { shell, fmtDateTime } from './admin.js';

const mode = (env) => env === 'live'
  ? '<span class="badge b-paid">Live</span>'
  : '<span class="badge b-pending">Test mode</span>';

export function businessesPage(ctx, { businesses }) {
  const rows = businesses.map((b) => `<tr class="row" onclick="location.href='/admin/platform/businesses/${b.id}'">
<td class="c-num"><a class="inv" href="/admin/platform/businesses/${b.id}">${esc(b.name)}</a><div class="small muted">${esc(b.email)}</div></td>
<td class="c-cust small">${b.logins} login${b.logins === 1 ? '' : 's'}${b.pending ? ` <span class="muted">(${b.pending} invite${b.pending === 1 ? '' : 's'} pending)</span>` : ''}<div class="muted">${b.sites} site${b.sites === 1 ? '' : 's'} connected</div></td>
<td class="c-date small muted">Added ${esc(fmtDateTime(b.created_at))}</td>
<td class="c-status">${mode(b.wipay_environment)}</td>
<td class="c-amount num">${b.is_active ? '' : '<span class="badge b-cancelled">Off</span>'}</td></tr>`).join('');

  return shell('Platform', ctx, 'platform', `
<div class="toolbar"><h1 style="margin:0;margin-right:auto">Client businesses</h1><a class="btn" href="/admin/platform/new">+ Add business</a></div>
<p class="small muted" style="margin-top:0">Setup details only. To see a client's invoices and payments, open their account; they are emailed every time.</p>
<div class="card" style="padding:0;overflow-x:auto">
${businesses.length ? `<table class="list"><thead><tr><th>Business</th><th>Setup</th><th>Added</th><th>Mode</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  : '<div class="empty">No client businesses yet. Add your first one.</div>'}
</div>`);
}

export function newBusinessPage(ctx, { values = {}, error } = {}) {
  const v = (k) => esc(values[k] ?? '');
  return shell('Add business', ctx, 'platform', `
<p class="small"><a href="/admin/platform">&larr; Client businesses</a></p>
<h1>Add a client business</h1>
<div class="card form">
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/platform/businesses">
<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">
<fieldset><legend>Business</legend>
<div class="row2">
<div class="field"><label for="name">Business name</label><input id="name" name="name" maxlength="80" required value="${v('name')}" autofocus></div>
<div class="field"><label for="email">Business email</label><input id="email" name="email" type="email" maxlength="80" required value="${v('email')}"><div class="hint">Receives access alerts</div></div>
</div>
<div class="field"><label for="currency">Currency</label><select id="currency" name="currency">
<option value="XCD" ${values.currency !== 'USD' ? 'selected' : ''}>EC$ (XCD)</option><option value="USD" ${values.currency === 'USD' ? 'selected' : ''}>US$ (USD)</option></select></div>
</fieldset>
<fieldset><legend>Their login</legend>
<div class="row2">
<div class="field"><label for="owner_name">Person's name</label><input id="owner_name" name="owner_name" maxlength="60" required value="${v('owner_name')}"></div>
<div class="field"><label for="owner_email">Their email</label><input id="owner_email" name="owner_email" type="email" maxlength="80" required value="${v('owner_email')}"><div class="hint">Gets an invite to set their own password</div></div>
</div></fieldset>
<button class="btn block" type="submit">Add business and send invite</button>
</form></div>`);
}

export function businessPage(ctx, { b, logins, access, notice, error }) {
  const notices = {
    created: ['ok', 'Business added. The invite email has been sent.'],
    invited: ['ok', 'Invite sent.'],
    resent: ['ok', 'A new invite was sent. The old link no longer works.'],
  };
  const n = notices[notice];
  const csrf = `<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`;
  const loginRows = logins.map((a) => `<div class="site"><div class="site-head"><div>
<div class="site-name">${esc(a.name)}</div><div class="site-meta">${esc(a.email)}</div>
<div class="site-meta">${a.has_password ? (a.last_login_at ? `Last logged in ${esc(fmtDateTime(a.last_login_at))}` : 'Password set, not logged in yet') : 'Invite pending'}</div></div>
${a.has_password ? '' : `<form method="post" action="/admin/platform/businesses/${b.id}/logins/${a.id}/resend">${csrf}<button class="btn ghost" type="submit">Resend invite</button></form>`}
</div></div>`).join('');

  return shell(b.name, ctx, 'platform', `
<p class="small"><a href="/admin/platform">&larr; Client businesses</a></p>
${n ? `<div class="alert ${n[0]}" role="status">${esc(n[1])}</div>` : ''}
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<div class="detail">
<div class="d-main card">
<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h1 style="margin:0">${esc(b.name)}</h1>${mode(b.wipay_environment)}</div>
<dl>
<div><dt>Business email</dt><dd>${esc(b.email)}</dd></div>
<div><dt>Currency</dt><dd>${esc(b.currency)}</dd></div>
<div><dt>WiPay account</dt><dd>${b.wipay_account_number ? 'Set up' : 'Not set up yet'}</dd></div>
<div><dt>Sites connected</dt><dd>${b.sites}</dd></div>
<div><dt>Added</dt><dd>${esc(fmtDateTime(b.created_at))}</dd></div>
</dl></div>
<div class="d-attempts card"><h2 style="font-size:16px;margin:0 0 8px">Logins</h2>
${loginRows || '<p class="small muted">No logins yet.</p>'}
<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">+ Invite another login</summary>
<form method="post" action="/admin/platform/businesses/${b.id}/logins" style="margin-top:10px">${csrf}
<div class="row2"><div class="field"><label for="li_name">Name</label><input id="li_name" name="name" maxlength="60" required></div>
<div class="field"><label for="li_email">Email</label><input id="li_email" name="email" type="email" maxlength="80" required></div></div>
<button class="btn" type="submit">Send invite</button></form></details>
</div>
<div class="d-side">
<div class="card share"><h2>Open their account</h2>
<p class="small muted">See their invoices and payments, and set up WiPay and site connections in their Settings. ${esc(b.name)} is emailed straight away and every action is recorded in their access history. Access ends after 1 hour.</p>
<form method="post" action="/admin/platform/businesses/${b.id}/open">${csrf}
<div class="field"><label for="reason">Reason</label><input id="reason" name="reason" maxlength="200" required placeholder="e.g. Setting up WiPay and their website"><div class="hint">Shown to the client</div></div>
<button class="btn block" type="submit">Open account</button></form></div>
<div class="card section"><h2>Recent access</h2>
${access.length ? access.slice(0, 8).map((a) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${esc(a.action)}</strong><div class="muted">${esc(a.actor_name)} &middot; ${esc(fmtDateTime(a.created_at))}${a.reason ? ` &middot; ${esc(a.reason)}` : ''}</div></div>`).join('') : '<p class="small muted" style="margin:0">Nothing yet.</p>'}
</div>
</div>
</div>`);
}
