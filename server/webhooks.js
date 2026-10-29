// Signed notifications to connected sites, with automatic retries.
//
// Each request has these headers:
//   X-PayPortal-Event:     e.g. invoice.paid
//   X-PayPortal-Delivery:  unique ID (sites can use it to ignore duplicates)
//   X-PayPortal-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" using the webhook secret>
import crypto from 'node:crypto';
import { pool } from './db.js';
import { decrypt } from './crypto.js';
import { invoiceJson } from './serializers.js';

// Wait times between tries: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h  -> then give up
const RETRY_MINUTES = [1, 5, 30, 120, 360, 720, 1440];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

export function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

// Adds a notification to the queue for the site that created the invoice (if it has a webhook URL),
// then tries to send it straight away.
export async function queueInvoiceEvent(event, invoiceId) {
  const { rows } = await pool.query(
    `SELECT i.*, s.id AS s_id, s.webhook_url, s.is_active AS site_active
       FROM invoices i JOIN sites s ON s.id = i.site_id
      WHERE i.id = $1`,
    [invoiceId]
  );
  const row = rows[0];
  if (!row || !row.webhook_url || !row.site_active) return;

  const { rows: [delivery] } = await pool.query(
    `INSERT INTO webhook_deliveries (site_id, invoice_id, event, payload)
     VALUES ($1, $2, $3, '{}') RETURNING id, public_id`,
    [row.s_id, row.id, event]
  );
  const payload = {
    id: delivery.public_id,
    event,
    created_at: new Date().toISOString(),
    data: { invoice: invoiceJson(row) },
  };
  await pool.query('UPDATE webhook_deliveries SET payload = $2 WHERE id = $1', [delivery.id, payload]);

  processDueWebhooks().catch((err) => console.error('Webhook send failed:', err.message));
}

async function sendOne(d) {
  const body = JSON.stringify(d.payload);
  let statusCode = null;
  let error = null;
  try {
    const res = await fetch(d.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PaymentPortal-Webhook/1.0',
        'X-PayPortal-Event': d.event,
        'X-PayPortal-Delivery': d.public_id,
        'X-PayPortal-Signature': signPayload(decrypt(d.webhook_secret_enc), body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) error = `Site answered HTTP ${res.status}`;
  } catch (err) {
    if (err.name === 'TimeoutError') error = 'Timed out after 10 seconds';
    else if (err.message === 'fetch failed') error = `Could not connect (${err.cause?.code || 'site unreachable'})`;
    else error = err.message;
  }

  const attempts = d.attempts + 1;
  if (!error) {
    await pool.query(
      `UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, last_status_code = $3,
              last_error = NULL, delivered_at = NOW() WHERE id = $1`,
      [d.id, attempts, statusCode]
    );
    console.log(`Webhook ${d.event} ${d.public_id}: delivered (HTTP ${statusCode})`);
  } else if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_status_code = $3, last_error = $4 WHERE id = $1`,
      [d.id, attempts, statusCode, error]
    );
    console.warn(`Webhook ${d.event} ${d.public_id}: gave up after ${attempts} tries (${error})`);
  } else {
    const wait = RETRY_MINUTES[attempts - 1];
    await pool.query(
      `UPDATE webhook_deliveries SET attempts = $2, last_status_code = $3, last_error = $4,
              next_attempt_at = NOW() + make_interval(mins => $5) WHERE id = $1`,
      [d.id, attempts, statusCode, error, wait]
    );
    console.warn(`Webhook ${d.event} ${d.public_id}: try ${attempts} failed (${error}), retrying in ${wait} min`);
  }
}

let running = false;

// Sends every notification that's due. Safe to call often; only one run happens at a time.
export async function processDueWebhooks() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT d.*, s.webhook_url, s.webhook_secret_enc
         FROM webhook_deliveries d JOIN sites s ON s.id = d.site_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
          AND s.webhook_url IS NOT NULL AND s.is_active
        ORDER BY d.next_attempt_at
        LIMIT 20`
    );
    for (const d of rows) await sendOne(d);
  } finally {
    running = false;
  }
}

// Checks the queue every 30 seconds while the service is running
export function startWebhookWorker() {
  const timer = setInterval(() => {
    processDueWebhooks().catch((err) => console.error('Webhook worker error:', err.message));
  }, 30000);
  timer.unref();
  processDueWebhooks().catch((err) => console.error('Webhook worker error:', err.message));
}
