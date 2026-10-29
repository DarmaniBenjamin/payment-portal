// A pretend connected site for testing webhooks. It checks each notification's signature
// the same way the WordPress plugin will.
//
// npm run mock:receiver -- --secret YOUR_WEBHOOK_SECRET [--fail]
//   --fail  answer with an error, to test retries
import express from 'express';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { secret: { type: 'string' }, fail: { type: 'boolean', default: false } } });
if (!values.secret) {
  console.error('Usage: npm run mock:receiver -- --secret YOUR_WEBHOOK_SECRET [--fail]');
  process.exit(1);
}

const PORT = 4200;
const MAX_AGE_SECONDS = 300; // reject notifications older than 5 minutes (stops replays)
const seen = new Set();
const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const body = req.body.toString('utf8');
  const header = req.get('x-payportal-signature') || '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  const expected = crypto.createHmac('sha256', values.secret).update(`${parts.t}.${body}`).digest('hex');

  const sigOk = parts.v1 && parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  const fresh = Number.isFinite(t) && Math.abs(Date.now() / 1000 - t) <= MAX_AGE_SECONDS;

  if (!sigOk || !fresh) {
    console.log(`[receiver] REJECTED: ${!sigOk ? 'bad signature' : 'too old'}`);
    return res.status(401).send('invalid signature');
  }
  if (values.fail) {
    console.log('[receiver] signature OK, but answering 500 to test retries');
    return res.status(500).send('pretend failure');
  }

  const delivery = req.get('x-payportal-delivery');
  if (seen.has(delivery)) {
    console.log(`[receiver] duplicate ${delivery}, ignoring`);
    return res.send('ok');
  }
  seen.add(delivery);

  const { event, data } = JSON.parse(body);
  console.log(`[receiver] VERIFIED ${event}: ${data.invoice.number} ${data.invoice.currency} ${data.invoice.amount} -> ${data.invoice.status}`);
  res.send('ok');
});

app.listen(PORT, () => console.log(`[receiver] listening on http://localhost:${PORT}/webhook`));
