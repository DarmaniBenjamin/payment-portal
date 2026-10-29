import './preflight.js'; // must stay first: checks settings before anything else loads
import express from 'express';
import { pool } from './db.js';
import { runMigrations } from './migrations.js';
import './crypto.js'; // checks ENCRYPTION_KEY at startup
import { requireSiteKey } from './middleware/requireSiteKey.js';
import { invoicesRouter } from './routes/invoices.js';
import { payRouter } from './routes/pay.js';
import { adminRouter } from './routes/admin.js';
import { startWebhookWorker } from './webhooks.js';
import { startEmailWorker } from './mailer.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const HTTPS = process.env.PUBLIC_URL.startsWith('https://');

// Behind a hosting proxy (SiteGround), trust it to tell us the visitor's real IP address,
// so login limits block the attacker, not everyone. TRUST_PROXY = number of proxies in front.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '');
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

app.disable('x-powered-by');
app.use((req, res, next) => {
  // Browsers only ever use https for this site once they've seen it (1 year)
  if (HTTPS) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '100kb' }));

// Root: simple message so visiting the base URL doesn't show "Cannot GET /"
app.get('/', (req, res) => {
  res.type('text').send('Payment service is running. Health check: /api/health');
});

// Health check: confirms the service is running and can reach the database
app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS time');
    res.json({ status: 'ok', database: 'connected', time: rows[0].time });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

// Lets a connected site check its API key works
app.get('/api/v1/me', requireSiteKey, (req, res) => {
  res.json({ site: req.site, merchant: req.merchant });
});

app.use('/api/v1/invoices', invoicesRouter);
app.use('/pay', payRouter);
app.use('/admin', adminRouter);

// Anything else under /api that doesn't exist
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Bad JSON and unexpected errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Server error' });
});

// Bring the database up to date before taking any requests
try {
  await runMigrations();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Payment service running on port ${PORT} (${process.env.PUBLIC_URL})`);
  startWebhookWorker();
  startEmailWorker();
});
