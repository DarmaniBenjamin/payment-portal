import express from 'express';
import { pool } from './db.js';
import './crypto.js'; // checks ENCRYPTION_KEY at startup
import { requireSiteKey } from './middleware/requireSiteKey.js';
import { invoicesRouter } from './routes/invoices.js';
import { payRouter } from './routes/pay.js';
import { adminRouter } from './routes/admin.js';
import { startWebhookWorker } from './webhooks.js';
import { startEmailWorker } from './mailer.js';

if (!process.env.PUBLIC_URL) {
  console.error('PUBLIC_URL is not set. Add it to .env (e.g. PUBLIC_URL=http://localhost:4000)');
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.disable('x-powered-by');
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

app.listen(PORT, () => {
  console.log(`Payment service running on http://localhost:${PORT}`);
  startWebhookWorker();
  startEmailWorker();
});
