// Creates a dashboard login for a business and prints a random password ONCE.
//
// npm run admin:create -- --merchant "Business name" --email you@example.com --name "Your Name"
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { pool } from '../db.js';
import { hashPassword } from '../auth.js';

const { values } = parseArgs({
  options: { merchant: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
});
if (!values.merchant || !values.email || !values.name) {
  console.error('Usage: npm run admin:create -- --merchant "Business name" --email you@example.com --name "Your Name"');
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
  console.error('--email must be a valid email address');
  process.exit(1);
}

try {
  const { rows } = await pool.query('SELECT id, name FROM merchants WHERE LOWER(name) = LOWER($1)', [values.merchant]);
  if (!rows.length) {
    console.error(`No merchant named "${values.merchant}". Create it first with npm run site:create`);
    process.exitCode = 1;
  } else {
    // Letters and numbers only, without look-alikes (0/O, 1/l/I), so it's easy to type
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const password = Array.from({ length: 16 }, () => chars[crypto.randomInt(chars.length)]).join('');
    await pool.query(
      'INSERT INTO admins (merchant_id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
      [rows[0].id, values.name, values.email.trim(), await hashPassword(password)]
    );
    console.log(`Created dashboard login for ${values.email} (${rows[0].name})\n`);
    console.log('Password (shown only once, save it now):');
    console.log(`  ${password}`);
  }
} catch (err) {
  console.error(err.code === '23505' ? `There is already a login for ${values.email}` : `Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
