// Public pages the customer visits: the pay link, and WiPay's return after checkout.
// No API key here: the invoice's random public_id is what identifies it.
import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { createCheckout, verifyResponseHash, wipayCredentials, formatTotal } from '../wipay.js';
import { queueInvoiceEvent } from '../webhooks.js';

export const payRouter = Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Simple placeholder page (the proper customer portal comes in a later step)
function page(res, status, title, message) {
  res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center;color:#222}h1{font-size:1.4rem}</style>
</head><body><h1>${esc(title)}</h1><p>${esc(message)}</p></body></html>`);
}

// Our reference for each payment attempt: letters/numbers only, 16 chars (WiPay's limit)
const newOrderId = () => 'pp' + crypto.randomBytes(10).toString('hex').slice(0, 14);

// Sends the customer back to the site that created the invoice, if it gave a return_url
function backToSite(res, invoice, status) {
  const url = new URL(invoice.return_url);
  url.searchParams.set('invoice', invoice.public_id);
  url.searchParams.set('status', status);
  res.redirect(303, url.toString());
}

// WiPay sends the customer here after checkout (must come before /:publicId)
payRouter.get('/return', async (req, res) => {
  const { order_id, status, transaction_id, hash, message } = req.query;
  if (typeof order_id !== 'string' || !order_id) return page(res, 400, 'Invalid response', 'Missing payment reference.');

  const { rows } = await pool.query(
    `SELECT p.id AS payment_id, p.amount AS payment_amount, p.status AS payment_status,
            i.*, m.wipay_environment, m.wipay_account_number, m.wipay_api_key_enc
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN merchants m ON m.id = p.merchant_id
      WHERE p.order_id = $1`,
    [order_id]
  );
  if (!rows.length) return page(res, 404, 'Payment not found', 'We could not find this payment.');
  const row = rows[0];

  // Already handled (e.g. customer refreshed the page): don't process twice
  if (row.payment_status === 'success') {
    return row.return_url ? backToSite(res, row, 'paid') : page(res, 200, 'Payment received', `Invoice ${row.number} is paid. Thank you!`);
  }

  if (status === 'success') {
    const { apiKey } = wipayCredentials(row);
    const txParts = String(transaction_id || '').split('-');
    const valid =
      txParts.includes(order_id) &&
      verifyResponseHash({ transactionId: transaction_id, originalTotal: row.payment_amount, hash, apiKey });

    if (!valid) {
      console.warn(`Payment ${order_id}: success response FAILED hash check, not marking paid`);
      await pool.query('UPDATE payments SET gateway_response = $2 WHERE id = $1', [row.payment_id, req.query]);
      return page(res, 400, 'Payment could not be verified', 'We could not confirm this payment. If you were charged, please contact us with your receipt.');
    }

    let newlyPaid = false;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE payments SET status = 'success', gateway_transaction_id = $2, gateway_response = $3, completed_at = NOW()
          WHERE id = $1 AND status <> 'success'`,
        [row.payment_id, transaction_id, req.query]
      );
      const paid = await client.query(
        `UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status <> 'paid'`,
        [row.id]
      );
      await client.query('COMMIT');
      newlyPaid = paid.rowCount === 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    console.log(`Payment ${order_id}: success, invoice ${row.number} paid`);

    // Tell the site that created the invoice (never blocks or breaks the customer's page)
    if (newlyPaid) {
      queueInvoiceEvent('invoice.paid', row.id).catch((err) =>
        console.error(`Could not queue webhook for ${row.number}:`, err.message)
      );
    }
    return row.return_url ? backToSite(res, row, 'paid') : page(res, 200, 'Payment received', `Invoice ${row.number} is paid. Thank you!`);
  }

  // failed / error / anything else
  await pool.query(
    `UPDATE payments SET status = 'failed', gateway_transaction_id = $2, gateway_response = $3, completed_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [row.payment_id, transaction_id || null, req.query]
  );
  console.log(`Payment ${order_id}: ${status} ${message || ''}`);
  if (row.return_url) return backToSite(res, row, 'failed');
  return page(res, 200, 'Payment not completed', 'Your payment did not go through. You can go back and try again.');
});

// The customer's pay link: creates a payment attempt and sends them to WiPay's checkout
payRouter.get('/:publicId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            m.id AS m_id, m.country_code, m.currency AS m_currency, m.wipay_environment, m.fee_structure,
            m.wipay_account_number, m.wipay_api_key_enc, m.is_active AS merchant_active
       FROM invoices i
       JOIN merchants m ON m.id = i.merchant_id
       LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.public_id = $1`,
    [req.params.publicId]
  );
  if (!rows.length) return page(res, 404, 'Invoice not found', 'This payment link is not valid.');
  const inv = rows[0];

  if (inv.status === 'paid') return page(res, 200, 'Already paid', `Invoice ${inv.number} has already been paid. Thank you!`);
  if (inv.status !== 'open' || !inv.merchant_active) return page(res, 410, 'Invoice unavailable', 'This invoice can no longer be paid. Please contact the business.');
  if (!inv.customer_email) return page(res, 400, 'Missing email', 'This invoice has no customer email, which is needed to pay by card.');

  const orderId = newOrderId();
  const { rows: [payment] } = await pool.query(
    `INSERT INTO payments (merchant_id, invoice_id, order_id, method, amount, currency)
     VALUES ($1, $2, $3, 'card', $4, $5) RETURNING id`,
    [inv.m_id, inv.id, orderId, inv.amount, inv.currency]
  );

  try {
    const merchant = {
      country_code: inv.country_code,
      currency: inv.currency,
      wipay_environment: inv.wipay_environment,
      fee_structure: inv.fee_structure,
      wipay_account_number: inv.wipay_account_number,
      wipay_api_key_enc: inv.wipay_api_key_enc,
    };
    const { url, transactionId } = await createCheckout({
      merchant,
      orderId,
      total: formatTotal(inv.amount),
      customer: { name: inv.customer_name, email: inv.customer_email, phone: inv.customer_phone },
      responseUrl: `${process.env.PUBLIC_URL.replace(/\/$/, '')}/pay/return`,
      data: { invoice: inv.number },
    });
    await pool.query('UPDATE payments SET gateway_transaction_id = $2 WHERE id = $1', [payment.id, transactionId]);
    res.redirect(303, url);
  } catch (err) {
    console.error(`Payment ${orderId}: could not start checkout:`, err.message);
    await pool.query(
      `UPDATE payments SET status = 'failed', gateway_response = $2, completed_at = NOW() WHERE id = $1`,
      [payment.id, { error: err.message }]
    );
    page(res, 502, 'Payment unavailable', 'We could not start the payment right now. Please try again in a few minutes.');
  }
});
