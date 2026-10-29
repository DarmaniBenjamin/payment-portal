// Sending email (invites, password links, access alerts) through an outbox with retries.
//
// With SMTP_HOST set in .env, emails go out through that mail server (e.g. Microsoft 365).
// Without it (local testing), each email is printed in the terminal instead of being sent.
import nodemailer from 'nodemailer';
import { pool } from './db.js';

const RETRY_MINUTES = [1, 5, 30, 120, 360, 720, 1440];

let transport = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,          // 465 = TLS from the start; 587 = STARTTLS
      requireTLS: port !== 465,      // never send over an unencrypted connection
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

// Adds an email to the outbox and tries to send it straight away. Never throws for send failures.
export async function queueEmail({ to, subject, body }) {
  const recipients = [...new Set([].concat(to).filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
  for (const email of recipients) {
    await pool.query('INSERT INTO email_outbox (to_email, subject, body) VALUES ($1, $2, $3)', [email, subject, body]);
  }
  processOutbox().catch((err) => console.error('Email send failed:', err.message));
}

async function sendOne(m) {
  const t = getTransport();
  let error = null;
  try {
    if (t) {
      await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.to_email, subject: m.subject, text: m.body });
    } else {
      console.log(`\n----- EMAIL (not sent: SMTP_HOST is not set) -----\nTo: ${m.to_email}\nSubject: ${m.subject}\n\n${m.body}\n--------------------------------------------------\n`);
    }
  } catch (err) {
    error = err.message;
  }

  const attempts = m.attempts + 1;
  if (!error) {
    await pool.query(`UPDATE email_outbox SET status = 'sent', attempts = $2, sent_at = NOW(), last_error = NULL WHERE id = $1`, [m.id, attempts]);
  } else if (attempts > RETRY_MINUTES.length) {
    await pool.query(`UPDATE email_outbox SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`, [m.id, attempts, error]);
    console.warn(`Email to ${m.to_email} gave up after ${attempts} tries: ${error}`);
  } else {
    const wait = RETRY_MINUTES[attempts - 1];
    await pool.query(
      `UPDATE email_outbox SET attempts = $2, last_error = $3, next_attempt_at = NOW() + make_interval(mins => $4) WHERE id = $1`,
      [m.id, attempts, error, wait]
    );
    console.warn(`Email to ${m.to_email} failed (${error}), retrying in ${wait} min`);
  }
}

let running = false;
export async function processOutbox() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY id LIMIT 20`
    );
    for (const m of rows) await sendOne(m);
  } finally {
    running = false;
  }
}

export function startEmailWorker() {
  const timer = setInterval(() => processOutbox().catch((err) => console.error('Email worker error:', err.message)), 30000);
  timer.unref();
  processOutbox().catch((err) => console.error('Email worker error:', err.message));
}
