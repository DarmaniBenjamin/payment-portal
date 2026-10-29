// Checks the API key a connected website sends, and loads its site + merchant.
// Sites send it as:  Authorization: Bearer pp_xxxxxxxx
import { pool } from '../db.js';
import { hashApiKey } from '../crypto.js';

export async function requireSiteKey(req, res, next) {
  const header = req.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!key.startsWith('pp_')) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT s.id AS site_id, s.name AS site_name, s.type AS site_type,
              m.id AS merchant_id, m.name AS merchant_name, m.currency, m.wipay_environment
         FROM sites s
         JOIN merchants m ON m.id = s.merchant_id
        WHERE s.api_key_hash = $1 AND s.is_active AND m.is_active`,
      [hashApiKey(key)]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Missing or invalid API key' });
    }
    const r = rows[0];
    req.site = { id: r.site_id, name: r.site_name, type: r.site_type };
    req.merchant = { id: r.merchant_id, name: r.merchant_name, currency: r.currency, environment: r.wipay_environment };
    next();
  } catch (err) {
    console.error('API key check failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}
