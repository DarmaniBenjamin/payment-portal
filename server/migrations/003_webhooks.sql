-- 003: queue of notifications we send to connected sites (e.g. "invoice.paid")
-- Each row is retried until the site answers with a 2xx, or we give up.

CREATE TABLE webhook_deliveries (
  id               SERIAL PRIMARY KEY,
  public_id        TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  invoice_id       INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  event            TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status_code INTEGER,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
