// HTML for the admin dashboard. Same look as the customer pages, plus tables and forms.
import { esc, money } from './payPage.js';

const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'America/Grenada' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Grenada' });
const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--text:#1c1f24;--muted:#5f6670;--line:#e3e6ea;--accent:#0f6e5c;--accent-hover:#0b5748;--accent-soft:#e6f2ef;
--ok-bg:#e7f6ef;--ok-text:#10633f;--warn-bg:#fff4e0;--warn-text:#8a5300;--bad-bg:#fdecec;--bad-text:#9b1c1c;--grey-bg:#eceef1;--grey-text:#5f6670;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111317;--card:#1b1e24;--text:#eceef1;--muted:#a2a9b3;--line:#2c313a;--accent:#2fb391;--accent-hover:#3cc8a3;--accent-soft:#163029;
--ok-bg:#12352a;--ok-text:#7ee0b4;--warn-bg:#3a2c10;--warn-text:#f5c46b;--bad-bg:#3d1717;--bad-text:#f4a3a3;--grey-bg:#262a31;--grey-text:#a2a9b3;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1040px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;margin-right:auto}
.brand small{display:block;font-weight:400;font-size:12px;color:var(--muted)}
nav a{color:var(--text);text-decoration:none;padding:6px 10px;border-radius:8px;font-weight:500}
nav a:hover{background:var(--accent-soft)}nav a.on{background:var(--accent-soft);color:var(--accent)}
.wrap{max-width:1040px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.stat .label{font-size:13px;color:var(--muted)}.stat .value{font-size:24px;font-weight:700;margin-top:2px}
.stat .sub{font-size:12px;color:var(--muted)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.tabs{display:flex;gap:4px;flex-wrap:wrap}
.tabs a{padding:6px 12px;border-radius:999px;text-decoration:none;color:var(--muted);border:1px solid var(--line);font-size:13px;background:var(--card)}
.tabs a.on{background:var(--accent);border-color:var(--accent);color:#fff}
.search{margin-left:auto;display:flex;gap:6px}
input,textarea,select{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:9px 11px;width:100%}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
.search input{width:220px}
.btn{display:inline-block;border:0;border-radius:8px;padding:9px 16px;font-family:inherit;font-weight:600;font-size:14px;line-height:1.3;cursor:pointer;
background:var(--accent);color:#fff;text-decoration:none;text-align:center;transition:background .15s,transform .05s;white-space:nowrap}
.btn:hover{background:var(--accent-hover)}.btn:active{transform:translateY(1px)}
.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}.btn.ghost:hover{background:var(--accent-soft)}
.btn.danger{background:transparent;color:var(--bad-text);border:1px solid var(--line)}.btn.danger:hover{background:var(--bad-bg)}
.btn.block{display:block;width:100%;padding:12px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr.row{cursor:pointer}tr.row:hover td{background:var(--accent-soft)}
td a.inv{font-weight:600;text-decoration:none;color:var(--text)}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.small{font-size:13px}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px}
.b-open{background:var(--warn-bg);color:var(--warn-text)}.b-paid{background:var(--ok-bg);color:var(--ok-text)}
.b-cancelled,.b-draft{background:var(--grey-bg);color:var(--grey-text)}
.b-success{background:var(--ok-bg);color:var(--ok-text)}.b-failed{background:var(--bad-bg);color:var(--bad-text)}.b-pending{background:var(--grey-bg);color:var(--grey-text)}
.empty{text-align:center;padding:40px 16px;color:var(--muted)}
.pager{display:flex;justify-content:space-between;margin-top:12px}
.form{max-width:560px}
.field{margin-bottom:14px}.field label{display:block;font-weight:600;font-size:14px;margin-bottom:4px}
.field .hint{font-size:12px;color:var(--muted);margin-top:3px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
fieldset{border:0;padding:0;margin:0 0 6px}legend{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-bottom:10px}
.alert{border-radius:10px;padding:11px 14px;margin-bottom:16px;font-size:14px}
.alert.bad{background:var(--bad-bg);color:var(--bad-text)}.alert.ok{background:var(--ok-bg);color:var(--ok-text)}.alert.warn{background:var(--warn-bg);color:var(--warn-text)}
.detail{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);grid-template-areas:'main side' 'attempts side';gap:16px;align-items:start}
.d-main{grid-area:main}.d-side{grid-area:side}.d-attempts{grid-area:attempts}
.amount{font-size:32px;font-weight:700;letter-spacing:-.02em;margin:4px 0}
dl{margin:16px 0 0;border-top:1px solid var(--line)}
dl div{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
dt{color:var(--muted)}dd{margin:0;text-align:right;word-break:break-word}
.share h2{font-size:16px;margin:0 0 4px}.share p{margin:0 0 12px}
.linkbox{display:flex;gap:6px;margin-bottom:10px}.linkbox input{font-size:13px}
.stack>*+*{margin-top:8px}
.section{margin-top:16px}.section h2{font-size:16px;margin:0 0 8px}
.login{max-width:380px;margin:12vh auto 0;padding:0 16px}
.login h1{text-align:center;font-size:20px;margin-bottom:4px}.login p.sub{text-align:center;color:var(--muted);margin:0 0 20px}
.logout button{background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;padding:6px 8px;border-radius:8px}
.logout button:hover{background:var(--accent-soft);color:var(--text)}
.settings{display:grid;gap:16px;max-width:760px}
.settings h2{font-size:17px;margin:0 0 4px}.settings .lead{margin:0 0 16px;color:var(--muted);font-size:14px}
select{appearance:auto}
.radio{display:flex;flex-direction:column;gap:8px}
.radio label{display:flex;gap:10px;align-items:flex-start;font-weight:400;border:1px solid var(--line);border-radius:8px;padding:10px 12px;cursor:pointer}
.radio label:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.radio input{width:auto;margin-top:3px}
.radio small{display:block;color:var(--muted);font-size:12px}
.site{border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px}
.site-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.site-name{font-weight:600}.site-meta{font-size:13px;color:var(--muted)}
.site-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.site-actions form{display:flex;gap:6px;flex:1 1 260px}
.site-actions .btn{padding:7px 12px;font-size:13px}
code.key{display:block;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;word-break:break-all;margin:4px 0 12px}
.danger-zone{border-color:var(--bad-bg)}
@media (max-width:760px){
  .bar{gap:8px 12px}
  .logout{margin-left:auto}
  nav{order:3;width:100%;display:flex;gap:4px;margin:0 -10px}
  .detail{grid-template-columns:1fr;grid-template-areas:'main' 'side' 'attempts'}
  .search{margin-left:0;width:100%}.search input{width:100%}
  .toolbar .btn:not(.ghost){width:100%}
  .row2{grid-template-columns:1fr}
  /* invoice table becomes a list of cards */
  table.list thead{display:none}
  table.list,table.list tbody{display:block}
  table.list tr.row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'num amount' 'cust status';
    gap:2px 12px;padding:12px 14px;border-bottom:1px solid var(--line)}
  table.list tr.row:last-child{border-bottom:0}
  table.list td{display:block;padding:0;border:0;background:none!important}
  table.list td.c-num{grid-area:num}table.list td.c-cust{grid-area:cust}
  table.list td.c-status{grid-area:status;text-align:right}table.list td.c-amount{grid-area:amount;font-weight:600}
  table.list td.c-date{display:none}
  table.list tr.row:hover{background:var(--accent-soft)}
}`;

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>${body}</body></html>`;
}

export function shell(title, ctx, active, body) {
  const envNote = ctx.merchant.environment === 'sandbox' ? '<small>Test mode (sandbox)</small>' : '';
  return page(`${title} - ${ctx.merchant.name}`, `
<header><div class="bar">
<div class="brand">${esc(ctx.merchant.name)}${envNote}</div>
<nav><a href="/admin" class="${active === 'invoices' ? 'on' : ''}">Invoices</a>
<a href="/admin/invoices/new" class="${active === 'new' ? 'on' : ''}">New invoice</a>
<a href="/admin/settings" class="${active === 'settings' ? 'on' : ''}">Settings</a></nav>
<form class="logout" method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">
<button type="submit" title="Signed in as ${esc(ctx.admin.email)}">Log out</button></form>
</div></header>
<div class="wrap">${body}</div>`);
}

export const badge = (status) => `<span class="badge b-${esc(status)}">${esc(status[0].toUpperCase() + status.slice(1))}</span>`;

export function loginPage({ error, email = '' } = {}) {
  return page('Log in', `<div class="login">
<h1>Payment Portal</h1><p class="sub">Log in to manage invoices</p>
<div class="card">
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login">
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}" ${email ? '' : 'autofocus'}></div>
<div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required ${email ? 'autofocus' : ''}></div>
<button class="btn block" type="submit">Log in</button>
</form></div></div>`);
}

export function dashboardPage(ctx, { invoices, totals, status, q, pageNo, hasMore }) {
  const cur = ctx.merchant.currency;
  const tab = (value, label) => {
    const params = new URLSearchParams();
    if (value !== 'all') params.set('status', value);
    if (q) params.set('q', q);
    const qs = params.toString();
    return `<a href="/admin${qs ? `?${qs}` : ''}" class="${status === value ? 'on' : ''}">${label}</a>`;
  };
  const pageLink = (n) => {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (q) params.set('q', q);
    if (n > 1) params.set('page', n);
    const qs = params.toString();
    return `/admin${qs ? `?${qs}` : ''}`;
  };

  const rows = invoices.map((i) => `<tr class="row" onclick="location.href='/admin/invoices/${esc(i.public_id)}'">
<td class="c-num"><a class="inv" href="/admin/invoices/${esc(i.public_id)}">${esc(i.number)}</a><div class="small muted">${esc(fmtDate(i.created_at))}</div></td>
<td class="c-cust">${esc(i.customer_name || '')}<div class="small muted">${esc(i.description)}</div></td>
<td class="c-date small muted">${i.status === 'paid' ? `Paid ${esc(fmtDate(i.paid_at))}` : i.due_date ? `Due ${esc(fmtDate(i.due_date))}` : ''}</td>
<td class="c-status">${badge(i.status)}</td>
<td class="c-amount num">${esc(money(i.amount, i.currency))}</td></tr>`).join('');

  return shell('Invoices', ctx, 'invoices', `
<div class="stats">
<div class="card stat"><div class="label">Outstanding</div><div class="value">${esc(money(totals.open_total, cur))}</div><div class="sub">${totals.open_count} open invoice${totals.open_count === 1 ? '' : 's'}</div></div>
<div class="card stat"><div class="label">Paid this month</div><div class="value">${esc(money(totals.paid_month_total, cur))}</div><div class="sub">${totals.paid_month_count} payment${totals.paid_month_count === 1 ? '' : 's'}</div></div>
</div>
<div class="toolbar">
<div class="tabs">${tab('all', 'All')}${tab('open', 'Open')}${tab('paid', 'Paid')}${tab('cancelled', 'Cancelled')}</div>
<form class="search" method="get" action="/admin">${status !== 'all' ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}
<input type="search" name="q" value="${esc(q)}" placeholder="Search number, customer, email" aria-label="Search invoices"><button class="btn ghost" type="submit">Search</button></form>
<a class="btn" href="/admin/invoices/new">+ New invoice</a>
</div>
<div class="card" style="padding:0;overflow-x:auto">
${invoices.length ? `<table class="list"><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
  : `<div class="empty">${q || status !== 'all' ? 'No invoices match.' : 'No invoices yet. Create your first one.'}</div>`}
</div>
${pageNo > 1 || hasMore ? `<div class="pager"><span>${pageNo > 1 ? `<a class="btn ghost" href="${pageLink(pageNo - 1)}">Previous</a>` : ''}</span><span>${hasMore ? `<a class="btn ghost" href="${pageLink(pageNo + 1)}">Next</a>` : ''}</span></div>` : ''}`);
}

export function newInvoicePage(ctx, { values = {}, error } = {}) {
  const v = (k) => esc(values[k] ?? '');
  const symbol = ctx.merchant.currency === 'XCD' ? 'EC$' : ctx.merchant.currency;
  return shell('New invoice', ctx, 'new', `
<h1>New invoice</h1>
<div class="card form">
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/invoices">
<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">
<fieldset><legend>Customer</legend>
<div class="field"><label for="customer_name">Name</label><input id="customer_name" name="customer_name" maxlength="60" value="${v('customer_name')}" placeholder="Business or person" autofocus></div>
<div class="row2">
<div class="field"><label for="customer_email">Email</label><input id="customer_email" name="customer_email" type="email" maxlength="50" required value="${v('customer_email')}"><div class="hint">Required by WiPay for card payments</div></div>
<div class="field"><label for="customer_phone">WhatsApp / phone</label><input id="customer_phone" name="customer_phone" type="tel" maxlength="20" value="${v('customer_phone')}" placeholder="+1 473 555 1234"><div class="hint">Optional, used for the WhatsApp button</div></div>
</div></fieldset>
<fieldset><legend>Invoice</legend>
<div class="field"><label for="description">What it's for</label><input id="description" name="description" maxlength="255" required value="${v('description')}" placeholder="e.g. Network setup at office"></div>
<div class="row2">
<div class="field"><label for="amount">Amount (${esc(symbol)})</label><input id="amount" name="amount" inputmode="decimal" required value="${v('amount')}" placeholder="0.00"></div>
<div class="field"><label for="due_date">Due date</label><input id="due_date" name="due_date" type="date" value="${v('due_date')}"><div class="hint">Optional</div></div>
</div></fieldset>
<button class="btn block" type="submit">Create invoice</button>
</form></div>`);
}

export function invoiceDetailPage(ctx, { inv, payments, payUrl, notice }) {
  const amount = money(inv.amount, inv.currency);
  const waText = `Hi${inv.customer_name && inv.customer_name !== inv.customer_email ? ` ${inv.customer_name}` : ''}, here is invoice ${inv.number} from ${ctx.merchant.name} for ${amount}. You can pay securely by card here: ${payUrl}`;
  const phoneDigits = String(inv.customer_phone || '').replace(/\D/g, '');
  const waUrl = `https://wa.me/${phoneDigits.length >= 7 ? phoneDigits : ''}?text=${encodeURIComponent(waText)}`;
  const mailUrl = `mailto:${encodeURIComponent(inv.customer_email || '')}?subject=${encodeURIComponent(`Invoice ${inv.number} from ${ctx.merchant.name}`)}&body=${encodeURIComponent(waText)}`;

  const notices = {
    created: ['ok', 'Invoice created. Send the pay link to your customer.'],
    cancelled: ['warn', 'Invoice cancelled. The pay link no longer accepts payments.'],
    'cannot-cancel': ['bad', 'Only open invoices can be cancelled.'],
  };
  const n = notices[notice];

  const paymentRows = payments.map((p) => `<tr><td class="small">${esc(fmtDateTime(p.created_at))}</td><td>${badge(p.status)}</td>
<td class="small muted">${esc(p.message || '')}</td><td class="num">${esc(money(p.amount, p.currency))}</td></tr>`).join('');

  const share = inv.status === 'open' ? `<div class="card share">
<h2>Send to customer</h2><p class="small muted">Anyone with this link can view and pay this invoice.</p>
<div class="linkbox"><input id="paylink" readonly value="${esc(payUrl)}" onclick="this.select()" aria-label="Pay link"><button class="btn ghost" type="button" id="copy">Copy</button></div>
<div class="stack">
<a class="btn block" href="${esc(waUrl)}" target="_blank" rel="noopener">Send on WhatsApp</a>
${inv.customer_email ? `<a class="btn ghost block" href="${esc(mailUrl)}">Send by email</a>` : ''}
<a class="btn ghost block" href="${esc(payUrl)}" target="_blank" rel="noopener">Open customer view</a>
</div></div>
<form class="section" method="post" action="/admin/invoices/${esc(inv.public_id)}/cancel" onsubmit="return confirm('Cancel invoice ${esc(inv.number)}? The customer will no longer be able to pay it.')">
<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}"><button class="btn danger block" type="submit">Cancel invoice</button></form>`
    : `<div class="card share"><h2>${inv.status === 'paid' ? 'Paid' : 'Not payable'}</h2>
<p class="small muted">${inv.status === 'paid' ? 'The customer can still open their link to see the receipt.' : 'This invoice was cancelled and can no longer be paid.'}</p>
${inv.status === 'paid' ? `<a class="btn ghost block" href="${esc(payUrl)}" target="_blank" rel="noopener">Open receipt</a>` : ''}</div>`;

  return shell(`Invoice ${inv.number}`, ctx, 'invoices', `
<p class="small"><a href="/admin">&larr; All invoices</a></p>
${n ? `<div class="alert ${n[0]}" role="status">${esc(n[1])}</div>` : ''}
<div class="detail">
<div class="card d-main">
<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="muted">Invoice ${esc(inv.number)}</span>${badge(inv.status)}</div>
<div class="amount">${esc(amount)}</div>
<div>${esc(inv.description)}</div>
<dl>
<div><dt>Customer</dt><dd>${esc(inv.customer_name || '')}</dd></div>
${inv.customer_email ? `<div><dt>Email</dt><dd>${esc(inv.customer_email)}</dd></div>` : ''}
${inv.customer_phone ? `<div><dt>Phone</dt><dd>${esc(inv.customer_phone)}</dd></div>` : ''}
<div><dt>Created</dt><dd>${esc(fmtDateTime(inv.created_at))}</dd></div>
${inv.due_date ? `<div><dt>Due</dt><dd>${esc(fmtDate(inv.due_date))}</dd></div>` : ''}
${inv.paid_at ? `<div><dt>Paid</dt><dd>${esc(fmtDateTime(inv.paid_at))}</dd></div>` : ''}
${inv.site_name ? `<div><dt>Created by</dt><dd>${esc(inv.site_name)}</dd></div>` : ''}
${inv.external_ref ? `<div><dt>Reference</dt><dd>${esc(inv.external_ref)}</dd></div>` : ''}
</dl></div>
<div class="card d-attempts"><h2 style="font-size:16px;margin:0 0 8px">Payment attempts</h2>
${payments.length ? `<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Result</th><th>Details</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table></div>`
  : '<p class="small muted" style="margin:0">None yet. Attempts appear here when the customer presses Pay.</p>'}
</div>
<div class="d-side">${share}</div>
</div>
<script>
(function(){var b=document.getElementById('copy');if(!b)return;var i=document.getElementById('paylink');
b.addEventListener('click',function(){var done=function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1500)};
if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(i.value).then(done,function(){i.select();document.execCommand('copy');done()})}
else{i.select();document.execCommand('copy');done()}})})();
</script>`);
}
