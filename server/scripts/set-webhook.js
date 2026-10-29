// Sets (or clears) the URL a site wants payment notifications sent to.
//
// npm run site:webhook -- --site-id 1 --url https://example.com/wp-json/payportal/v1/webhook
// npm run site:webhook -- --site-id 1 --clear
import { parseArgs } from 'node:util';
import { pool } from '../db.js';

const { values } = parseArgs({
  options: {
    'site-id': { type: 'string' },
    url: { type: 'string' },
    clear: { type: 'boolean', default: false },
  },
});

const usage = 'Usage: npm run site:webhook -- --site-id 1 --url https://example.com/webhook   (or --clear)';
if (!values['site-id'] || !/^\d+$/.test(values['site-id']) || (!values.url && !values.clear)) {
  console.error(usage);
  process.exit(1);
}

let url = null;
if (!values.clear) {
  try {
    const u = new URL(values.url);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error();
    url = u.toString();
  } catch {
    console.error('--url must be a full https:// URL (http:// is only allowed for localhost testing)');
    process.exit(1);
  }
}

try {
  const { rows } = await pool.query(
    'UPDATE sites SET webhook_url = $2 WHERE id = $1 RETURNING name',
    [Number(values['site-id']), url]
  );
  if (!rows.length) {
    console.error(`No site with id ${values['site-id']}`);
    process.exitCode = 1;
  } else {
    console.log(url ? `Site "${rows[0].name}" will be notified at ${url}` : `Webhooks turned off for site "${rows[0].name}"`);
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
