-- 004: people who log in to the admin dashboard, and their login sessions

CREATE TABLE admins (
  id             SERIAL PRIMARY KEY,
  merchant_id    INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,             -- scrypt, never the password itself
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX admins_email_uniq ON admins (LOWER(email));

CREATE TABLE admin_sessions (
  id             SERIAL PRIMARY KEY,
  admin_id       INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,      -- only a hash of the cookie value is stored
  csrf_token     TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);
