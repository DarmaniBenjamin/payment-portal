// `npm run db:migrate`: brings the database up to date (the service also does this when it starts).
import { pool } from './db.js';
import { runMigrations } from './migrations.js';

try {
  const ran = await runMigrations();
  if (ran === 0) console.log('Database is up to date.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
