-- 005: Protonic as the platform account, client logins by email invite,
-- an email outbox with retries, and a permanent access history for each client.

-- The one business that runs the platform (Protonic). Its logins get the Platform area.
ALTER TABLE merchants ADD COLUMN is_platform BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX merchants_one_platform ON merchants (is_platform) WHERE is_platform;

-- Invited logins have no password until they set their own
ALTER TABLE admins ALTER COLUMN password_hash DROP NOT NULL;

-- One-time links for setting a password (invites and "forgot password")
CREATE TABLE admin_tokens (
  id          SERIAL PRIMARY KEY,
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  token_hash  TEXT NOT NULL UNIQUE,         -- only a hash of the link's token is stored
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Support access: a platform login temporarily inside a client's account (max 1 hour)
ALTER TABLE admin_sessions
  ADD COLUMN acting_merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
  ADD COLUMN acting_until TIMESTAMPTZ;

-- Emails waiting to be sent; retried until they go out
CREATE TABLE email_outbox (
  id              SERIAL PRIMARY KEY,
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ
);
CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status = 'pending';

-- Everything the platform does in or to a client's account. The client sees this list.
CREATE TABLE access_log (
  id           SERIAL PRIMARY KEY,
  merchant_id  INTEGER NOT NULL REFERENCES merchants(id),
  actor_name   TEXT NOT NULL,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  reason       TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX access_log_merchant_idx ON access_log (merchant_id, created_at DESC);

-- The access history can only ever be added to: no edits, no deletes
CREATE FUNCTION access_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER access_log_no_change
  BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_append_only();
CREATE TRIGGER access_log_no_truncate
  BEFORE TRUNCATE ON access_log
  FOR EACH STATEMENT EXECUTE FUNCTION access_log_append_only();
