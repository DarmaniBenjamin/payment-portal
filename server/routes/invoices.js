// API used by connected sites (WordPress plugin, JS embed, apps) to create and check invoices.
// Every route here needs the site's API key (see requireSiteKey).
import { Router } from 'express';
import { pool } from '../db.js';
import { requireSiteKey } from '../middleware/requireSiteKey.js';
import { invoiceJson } from '../serializers.js';
import { validateInvoiceInput, createInvoice } from '../services/invoices.js';

export const invoicesRouter = Router();
invoicesRouter.use(requireSiteKey);

// Create an invoice and get back a pay link for the customer
invoicesRouter.post('/', async (req, res) => {
  const error = validateInvoiceInput(req.body || {});
  if (error) return res.status(400).json({ error });

  const invoice = await createInvoice({
    merchantId: req.merchant.id,
    currency: req.merchant.currency,
    siteId: req.site.id,
    input: req.body,
  });
  res.status(201).json({ invoice: invoiceJson(invoice) });
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
