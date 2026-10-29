// Marks the business that runs the platform (e.g. Protonic). Its logins get the Platform area.
// Only one business can be the platform.
//
// npm run platform:set -- --merchant "Business name"
import { parseArgs } from 'node:util';
import { pool } from '../db.js';

const { values } = parseArgs({ options: { merchant: { type: 'string' } } });
if (!values.merchant) {
  console.error('Usage: npm run platform:set -- --merchant "Business name"');
  process.exit(1);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query('SELECT id, name FROM merchants WHERE LOWER(name) = LOWER($1)', [values.merchant]);
  if (!rows.length) {
    console.error(`No merchant named "${values.merchant}".`);
    process.exitCode = 1;
    await client.query('ROLLBACK');
  } else {
    await client.query('UPDATE merchants SET is_platform = FALSE WHERE is_platform AND id <> $1', [rows[0].id]);
    await client.query('UPDATE merchants SET is_platform = TRUE WHERE id = $1', [rows[0].id]);
    await client.query('COMMIT');
    console.log(`"${rows[0].name}" is now the platform account. Its logins will see Platform in the dashboard.`);
  }
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
