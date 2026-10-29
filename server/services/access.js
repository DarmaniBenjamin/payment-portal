// The client-visible access history, and emails telling a client what the platform did.
import { pool } from '../db.js';
import { queueEmail } from '../mailer.js';

const timeFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Grenada' });
export const nowText = () => timeFmt.format(new Date());

export async function logAccess({ merchantId, actor, action, reason = null, ip = null }) {
  await pool.query(
    'INSERT INTO access_log (merchant_id, actor_name, actor_email, action, reason, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [merchantId, actor.name, actor.email, action, reason, ip]
  );
}

export async function recentAccess(merchantId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT actor_name, actor_email, action, reason, created_at FROM access_log WHERE merchant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [merchantId, limit]
  );
  return rows;
}

// Emails the client business and everyone with a login there
export async function notifyClient(merchantId, subject, body) {
  const { rows } = await pool.query(
    `SELECT m.name, m.email, ARRAY_REMOVE(ARRAY_AGG(a.email) FILTER (WHERE a.is_active AND a.password_hash IS NOT NULL), NULL) AS logins
       FROM merchants m LEFT JOIN admins a ON a.merchant_id = m.id
      WHERE m.id = $1 GROUP BY m.id`,
    [merchantId]
  );
  if (!rows.length) return;
  const footer = `\n\nYou can see every time the platform team opened or changed your account under Settings > Access history:\n${process.env.PUBLIC_URL.replace(/\/$/, '')}/admin/settings#access\n\nThese alerts are always sent and cannot be turned off.`;
  await queueEmail({ to: [rows[0].email, ...(rows[0].logins || [])], subject, body: body + footer });
}
