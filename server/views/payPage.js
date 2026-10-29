// HTML for the customer-facing pages: the invoice/pay page and simple message pages.
// Plain server-rendered HTML (no build step), works on phones, follows light/dark mode.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SYMBOLS = { XCD: 'EC$', USD: 'US$' };
export function money(amount, currency) {
  const n = Number(amount).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return SYMBOLS[currency] ? `${SYMBOLS[currency]}${n}` : `${currency} ${n}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'America/Grenada' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Grenada' });

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--text:#1c1f24;--muted:#5f6670;--line:#e3e6ea;--accent:#0f6e5c;--accent-hover:#0b5748;
--ok-bg:#e7f6ef;--ok-text:#10633f;--warn-bg:#fff4e0;--warn-text:#8a5300;--bad-bg:#fdecec;--bad-text:#9b1c1c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111317;--card:#1b1e24;--text:#eceef1;--muted:#a2a9b3;--line:#2c313a;--accent:#2fb391;--accent-hover:#3cc8a3;
--ok-bg:#12352a;--ok-text:#7ee0b4;--warn-bg:#3a2c10;--warn-text:#f5c46b;--bad-bg:#3d1717;--bad-text:#f4a3a3;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
main{width:100%;max-width:440px}
.merchant{font-weight:600;font-size:15px;color:var(--muted);text-align:center;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
.number{font-size:14px;color:var(--muted)}
.badge{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--warn-bg);color:var(--warn-text)}
.badge.paid{background:var(--ok-bg);color:var(--ok-text)}
.amount{font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:0 0 6px}
.desc{margin:0 0 20px;color:var(--text)}
dl{margin:0 0 24px;border-top:1px solid var(--line)}
dl:last-child{margin-bottom:0}
dl div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
dt{color:var(--muted)}dd{margin:0;text-align:right;word-break:break-word}
.btn{display:block;width:100%;border:0;border-radius:10px;padding:14px 16px;font-family:inherit;font-weight:600;font-size:16px;line-height:1.2;cursor:pointer;
background:var(--accent);color:#fff;text-align:center;text-decoration:none;transition:background .15s,transform .05s}
.btn:hover{background:var(--accent-hover)}.btn:active{transform:translateY(1px)}
.btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.note{font-size:13px;color:var(--muted);text-align:center;margin:12px 0 0}
.banner{border-radius:10px;padding:12px 14px;margin:0 0 20px;font-size:14px}
.banner.ok{background:var(--ok-bg);color:var(--ok-text)}.banner.warn{background:var(--warn-bg);color:var(--warn-text)}
.banner.bad{background:var(--bad-bg);color:var(--bad-text)}
.banner strong{display:block;font-size:15px;margin-bottom:2px}
.message{text-align:center}.message h1{font-size:20px;margin:0 0 8px}.message p{margin:0;color:var(--muted)}
footer{margin-top:20px;font-size:12px;color:var(--muted);text-align:center}
@media (max-width:380px){.card{padding:20px}.amount{font-size:34px}}
`;

function layout(title, merchantName, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body><main>
${merchantName ? `<p class="merchant">${esc(merchantName)}</p>` : ''}
${body}
<footer>Secure card payment by WiPay. Your card details are entered on WiPay's page, never on this site.</footer>
</main></body></html>`;
}

// The invoice page. result: 'paid' | 'failed' | 'unverified' | undefined (just arrived)
export function invoicePage(inv, result) {
  const isPaid = inv.status === 'paid';
  const amount = money(inv.amount, inv.currency);

  let banner = '';
  if (isPaid && result === 'paid') {
    banner = `<div class="banner ok" role="status"><strong>Payment received</strong>Thank you! You can keep this page as your receipt.</div>`;
  } else if (!isPaid && result === 'failed') {
    banner = `<div class="banner bad" role="alert"><strong>Payment didn't go through</strong>Your card wasn't accepted. You can try again or use another card.</div>`;
  } else if (!isPaid && result === 'unverified') {
    banner = `<div class="banner warn" role="alert"><strong>We couldn't confirm this payment</strong>If you were charged, please contact ${esc(inv.merchant_name)} before paying again.</div>`;
  }

  const rows = [
    inv.customer_name && inv.customer_name !== inv.customer_email ? ['Billed to', inv.customer_name] : null,
    inv.customer_email ? ['Email', inv.customer_email] : null,
    inv.due_date && !isPaid ? ['Due', dateFmt.format(new Date(inv.due_date))] : null,
    isPaid && inv.paid_at ? ['Paid', dateTimeFmt.format(new Date(inv.paid_at))] : null,
  ].filter(Boolean);

  const action = isPaid
    ? ''
    : `<form method="post" action="/pay/${esc(inv.public_id)}/checkout">
<button class="btn" type="submit">Pay ${esc(amount)} by card</button></form>
${inv.fee_structure === 'customer_pay' ? '<p class="note">A card processing fee is added at checkout.</p>' : ''}
${inv.fee_structure === 'split' ? '<p class="note">Part of the card processing fee is added at checkout.</p>' : ''}`;

  const body = `<div class="card">
${banner}
<div class="top"><span class="number">Invoice ${esc(inv.number)}</span>
<span class="badge${isPaid ? ' paid' : ''}">${isPaid ? 'Paid' : 'Due'}</span></div>
<p class="amount">${esc(amount)}</p>
<p class="desc">${esc(inv.description)}</p>
${rows.length ? `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
${action}
</div>`;
  return layout(`${isPaid ? 'Paid' : 'Pay'}: Invoice ${inv.number} - ${inv.merchant_name}`, inv.merchant_name, body);
}

export function messagePage(title, message, merchantName) {
  return layout(title, merchantName, `<div class="card message"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`);
}
