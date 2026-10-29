// A pretend WiPay for local testing, following WiPay's documented request/response format.
// It never touches real cards or money. Start it with: npm run mock:wipay
// Then set WIPAY_BASE_URL=http://localhost:4100/plugins in .env and restart the service.
import express from 'express';
import crypto from 'node:crypto';

const PORT = 4100;
const API_KEY = '123'; // same as WiPay's public sandbox key
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const sessions = new Map();
const ID_RE = /^(?![_-])[a-zA-Z0-9_-]+(?<![_-])$/;
const required = ['account_number', 'country_code', 'currency', 'environment', 'fee_structure', 'method', 'order_id', 'origin', 'response_url', 'total', 'email'];

app.post('/plugins/payments/request', (req, res) => {
  const b = req.body || {};
  const missing = required.find((k) => b[k] === undefined || b[k] === '');
  if (missing) return res.status(400).json({ url: '', message: `The ${missing.replace(/_/g, ' ')} field is required.`, transaction_id: '' });
  if (!ID_RE.test(b.order_id)) return res.status(400).json({ url: '', message: 'The order id format is invalid.', transaction_id: '' });
  if (b.environment !== 'sandbox') return res.status(400).json({ url: '', message: 'Mock only supports sandbox.', transaction_id: '' });

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const transactionId = `SB-${1 + Math.floor(Math.random() * 99)}-999-${b.order_id}-${stamp}`;
  sessions.set(transactionId, b);
  console.log(`[mock-wipay] checkout created ${transactionId} for ${b.currency} ${b.total}`);
  res.json({ url: `http://localhost:${PORT}/checkout?tx=${encodeURIComponent(transactionId)}`, message: 'OK', transaction_id: transactionId });
});

app.get('/checkout', (req, res) => {
  const b = sessions.get(req.query.tx);
  if (!b) return res.status(404).send('Unknown checkout');
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;max-width:420px;margin:10vh auto;padding:0 16px">
<p style="background:#fff3cd;padding:8px;border-radius:6px">MOCK WiPay checkout (testing only)</p>
<h2>Pay ${b.currency} ${Number(b.total).toFixed(2)}</h2><p>Customer: ${b.email}</p>
<form method="post" action="/checkout/complete"><input type="hidden" name="tx" value="${req.query.tx}">
<button name="result" value="success" style="padding:10px 16px">Approve payment</button>
<button name="result" value="failed" style="padding:10px 16px">Decline payment</button></form></body>`);
});

app.post('/checkout/complete', (req, res) => {
  const tx = req.body.tx;
  const b = sessions.get(tx);
  if (!b) return res.status(404).send('Unknown checkout');
  sessions.delete(tx);

  const original = Number(b.total).toFixed(2);
  const q = new URLSearchParams({
    card: '(VISA) ... 4242',
    currency: b.currency,
    customer_email: b.email,
    customer_name: b.name || 'Test Customer',
    data: b.data || '',
    date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    order_id: b.order_id,
    transaction_id: tx,
    total: b.fee_structure === 'customer_pay' ? (Number(original) * 1.0483).toFixed(2) : original,
  });
  if (req.body.result === 'success') {
    q.set('status', 'success');
    q.set('message', '[1-R1]: Transaction is approved.');
    q.set('hash', crypto.createHash('md5').update(tx + original + API_KEY).digest('hex'));
  } else {
    q.set('status', 'failed');
    q.set('message', '[2-R211]: CVN is invalid.');
  }
  console.log(`[mock-wipay] ${tx} -> ${q.get('status')}`);
  res.redirect(303, `${b.response_url}?${q}`);
});

app.listen(PORT, () => console.log(`[mock-wipay] running on http://localhost:${PORT}`));
