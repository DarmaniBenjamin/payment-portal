// Creates a merchant (if it doesn't exist yet) and a connected site, then prints
// the site's API key ONCE. Used until the admin dashboard exists.
//
// npm run site:create -- --merchant "Business name" --email you@example.com --site "Site name" [--type wordpress|static|app] [--url https://...]
import { parseArgs } from 'node:util';
import { pool } from '../db.js';
import { generateApiKey, encrypt, randomSecret } from '../crypto.js';

const { values } = parseArgs({
  options: {
    merchant: { type: 'string' },
    email: { type: 'string' },
    site: { type: 'string' },
    type: { type: 'string', default: 'wordpress' },
    url: { type: 'string' },
  },
});

if (!values.merchant || !values.email || !values.site) {
  console.error('Usage: npm run site:create -- --merchant "Business name" --email you@example.com --site "Site name" [--type wordpress|static|app] [--url https://...]');
  process.exit(1);
}
if (!['wordpress', 'static', 'app'].includes(values.type)) {
  console.error('--type must be wordpress, static or app');
  process.exit(1);
}

let client;
try {
  client = await pool.connect();

  await client.query('BEGIN');

  let { rows } = await client.query('SELECT id FROM merchants WHERE LOWER(name) = LOWER($1)', [values.merchant]);
  let merchantId;
  if (rows.length) {
    merchantId = rows[0].id;
    console.log(`Using existing merchant "${values.merchant}" (id ${merchantId})`);
  } else {
    ({ rows } = await client.query(
      'INSERT INTO merchants (name, email) VALUES ($1, $2) RETURNING id',
      [values.merchant, values.email]
    ));
    merchantId = rows[0].id;
    console.log(`Created merchant "${values.merchant}" (id ${merchantId})`);
  }

  const { key, prefix, hash } = generateApiKey();
  const webhookSecret = randomSecret();
  ({ rows } = await client.query(
    `INSERT INTO sites (merchant_id, name, type, url, api_key_prefix, api_key_hash, webhook_secret_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [merchantId, values.site, values.type, values.url || null, prefix, hash, encrypt(webhookSecret)]
  ));
  await client.query('COMMIT');

  console.log(`Created site "${values.site}" (id ${rows[0].id})\n`);
  console.log('API key (shown only once, save it now):');
  console.log(`  ${key}\n`);
  console.log('Webhook secret (the site uses this to check our payment notifications):');
  console.log(`  ${webhookSecret}`);
} catch (err) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
