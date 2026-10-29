// Creating invoices, shared by the site API and the admin dashboard so both follow the same rules.
import { pool } from '../db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns an error message, or null if the input is fine
export function validateInvoiceInput(body) {
  const amount = Number(body.amount);
  if (body.amount === '' || !Number.isFinite(amount) || amount <= 0 || amount > 999999.99) return 'amount must be a number between 0.01 and 999999.99';
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(4))) return 'amount can have at most 2 decimal places';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 255) return 'description is required (max 255 characters)';
  const c = body.customer;
  if (!c || typeof c !== 'object') return 'customer is required';
  if (typeof c.email !== 'string' || !EMAIL_RE.test(c.email.trim()) || c.email.length > 50) return 'customer.email must be a valid email (max 50 characters)';
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

// Creates the invoice (and the customer, if new). Input must already be validated.
// Returns the new invoice row.
export async function createInvoice({ merchantId, currency, siteId = null, input }) {
  const { amount, description, customer, return_url, due_date, external_ref } = input;
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
      [merchantId, customer.name?.trim() || null, customer.email.trim(), customer.phone?.trim() || null]
    );

    // Next invoice number for this merchant
    const { rows: [counter] } = await client.query(
      `UPDATE merchants SET next_invoice_number = next_invoice_number + 1
        WHERE id = $1 RETURNING next_invoice_number - 1 AS n`,
      [merchantId]
    );
    const number = `INV-${String(counter.n).padStart(4, '0')}`;

    const { rows: [invoice] } = await client.query(
      `INSERT INTO invoices (merchant_id, customer_id, site_id, number, description, amount, currency,
                            external_ref, due_date, return_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [merchantId, cust.id, siteId, number, description.trim(), Number(amount).toFixed(2),
       currency, external_ref || null, due_date || null, return_url || null]
    );

    await client.query('COMMIT');
    return invoice;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
