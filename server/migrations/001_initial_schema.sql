-- 001: initial tables for the payment portal
-- A "merchant" is a business that gets paid (you, or a Protonic client).
-- Each merchant has its own WiPay account, websites, customers and invoices.

CREATE TABLE merchants (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  country_code     CHAR(2) NOT NULL DEFAULT 'GD',
  currency         CHAR(3) NOT NULL DEFAULT 'XCD',
  wipay_account_number TEXT,
  wipay_api_key_enc    TEXT,            -- stored encrypted, never plain text
  wipay_environment    TEXT NOT NULL DEFAULT 'sandbox'
                       CHECK (wipay_environment IN ('sandbox', 'live')),
  fee_structure    TEXT NOT NULL DEFAULT 'customer_pay'
                   CHECK (fee_structure IN ('customer_pay', 'split', 'merchant_absorb')),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Websites that connect to the service (WordPress plugin, JS embed, Uplink, etc.)
CREATE TABLE sites (
  id               SERIAL PRIMARY KEY,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'wordpress'
                   CHECK (type IN ('wordpress', 'static', 'app')),
  url              TEXT,
  api_key_prefix   TEXT NOT NULL,          -- first few characters, shown in the dashboard
  api_key_hash     TEXT NOT NULL UNIQUE,   -- only a hash is stored, never the key itself
  webhook_url      TEXT,                   -- where we tell the site a payment succeeded
  webhook_secret_enc TEXT,                 -- used to sign those notifications
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id               SERIAL PRIMARY KEY,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX customers_merchant_idx ON customers (merchant_id);
CREATE UNIQUE INDEX customers_merchant_email_uniq
  ON customers (merchant_id, LOWER(email)) WHERE email IS NOT NULL;

CREATE TABLE invoices (
  id               SERIAL PRIMARY KEY,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id      INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  site_id          INTEGER REFERENCES sites(id) ON DELETE SET NULL,  -- which site created it
  number           TEXT NOT NULL,           -- e.g. INV-0001, unique per merchant
  description      TEXT NOT NULL,
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'XCD',
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('draft', 'open', 'paid', 'cancelled')),
  external_ref     TEXT,                    -- e.g. the WooCommerce order ID
  due_date         DATE,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, number)
);
CREATE INDEX invoices_merchant_status_idx ON invoices (merchant_id, status);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);

-- Every attempt to pay an invoice (one invoice can have failed tries before it's paid)
CREATE TABLE payments (
  id               SERIAL PRIMARY KEY,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id         TEXT NOT NULL UNIQUE,    -- our reference sent to WiPay
  method           TEXT NOT NULL DEFAULT 'card'
                   CHECK (method IN ('card', 'bank_transfer')),
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  fee              NUMERIC(12, 2),
  currency         CHAR(3) NOT NULL DEFAULT 'XCD',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'success', 'failed')),
  gateway_transaction_id TEXT,              -- WiPay's transaction ID
  gateway_response JSONB,                   -- full response kept for troubleshooting
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_merchant_status_idx ON payments (merchant_id, status);
