-- 002: fields needed for the payment flow

-- Public, unguessable ID used in the customer's pay link (/pay/<public_id>)
ALTER TABLE invoices
  ADD COLUMN public_id TEXT NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ADD COLUMN return_url TEXT;   -- where to send the customer after paying (e.g. back to the WordPress site)

-- Per-merchant invoice counter, so numbers go INV-0001, INV-0002, ...
ALTER TABLE merchants
  ADD COLUMN next_invoice_number INTEGER NOT NULL DEFAULT 1;
