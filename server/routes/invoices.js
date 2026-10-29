// API used by connected sites (WordPress plugin, JS embed, apps) to create and check invoices.
// Every route here needs the site's API key (see requireSiteKey).
import { Router } from 'express';
import { pool } from '../db.js';
import { requireSiteKey } from '../middleware/requireSiteKey.js';
import { invoiceJson } from '../serializers.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireSiteKey);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns an error message, or null if the request body is fine
function validate(body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999.99) return 'amount must be a number between 0.01 and 999999.99';
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) return 'amount can have at most 2 decimal places';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 255) return 'description is required (max 255 characters)';
  const c = body.customer;
  if (!c || typeof c !== 'object') return 'customer is required';
  if (typeof c.email !== 'string' || !EMAIL_RE.test(c.email) || c.email.length > 50) return 'customer.email must be a valid email (max 50 characters)';
  if (c.name != null && (typeof c.name !== 'string' || c.name.length > 60)) return 'customer.name must be text (max 60 characters)';
  if (c.phone != null && (typeof c.phone !== 'string' || c.phone.length > 20)) return 'customer.phone must be text (max 20 characters)';
  if (body.return_url != null) {
    try {
      const u = new URL(body.return_url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    } catch {
      return 'return_url must be a full http(s) URL';
    }
  }
  if (body.due_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) return 'due_date must look like 2026-12-31';
  if (body.external_ref != null && (typeof body.external_ref !== 'string' || body.external_ref.length > 100)) return 'external_ref must be text (max 100 characters)';
  return null;
}

// Create an invoice and get back a pay link for the customer
invoicesRouter.post('/', async (req, res) => {
  const error = validate(req.body || {});
  if (error) return res.status(400).json({ error });

  const { amount, description, customer, return_url, due_date, external_ref } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find or create the customer (matched by email, per merchant)
    const { rows: [cust] } = await client.query(
      `INSERT INTO customers (merchant_id, name, email, phone)
       VALUES ($1, COALESCE($2, $3), $3, $4)
       ON CONFLICT (merchant_id, LOWER(email)) WHERE email IS NOT NULL
       DO UPDATE SET name = COALESCE($2, customers.name),
                     phone = COALESCE($4, customers.phone),
                     updated_at = NOW()
       RETURNING id`,
      [req.merchant.id, customer.name?.trim() || null, customer.email.trim(), customer.phone?.trim() || null]
    );

    // Next invoice number for this merchant
    const { rows: [counter] } = await client.query(
      `UPDATE merchants SET next_invoice_number = next_invoice_number + 1
        WHERE id = $1 RETURNING next_invoice_number - 1 AS n`,
      [req.merchant.id]
    );
    const number = `INV-${String(counter.n).padStart(4, '0')}`;

    const { rows: [invoice] } = await client.query(
      `INSERT INTO invoices (merchant_id, customer_id, site_id, number, description, amount, currency,
                            external_ref, due_date, return_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.merchant.id, cust.id, req.site.id, number, description.trim(), Number(amount).toFixed(2),
       req.merchant.currency, external_ref || null, due_date || null, return_url || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ invoice: invoiceJson(invoice) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Check an invoice's status (e.g. the WordPress plugin confirming an order was paid)
invoicesRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM invoices WHERE public_id = $1 AND merchant_id = $2',
    [req.params.id, req.merchant.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice: invoiceJson(rows[0]) });
});
