// Saves a merchant's WiPay details. The API key is stored encrypted.
//
// npm run merchant:wipay -- --merchant "Business name" --account 1234567890 --api-key KEY --environment sandbox|live [--fee customer_pay|split|merchant_absorb] [--currency XCD|USD]
import { parseArgs } from 'node:util';
import { pool } from '../db.js';
import { encrypt } from '../crypto.js';

const { values } = parseArgs({
  options: {
    merchant: { type: 'string' },
    account: { type: 'string' },
    'api-key': { type: 'string' },
    environment: { type: 'string' },
    fee: { type: 'string' },
    currency: { type: 'string' },
  },
});

const usage = 'Usage: npm run merchant:wipay -- --merchant "Business name" --account 1234567890 --api-key KEY --environment sandbox|live [--fee customer_pay|split|merchant_absorb] [--currency XCD|USD]';
if (!values.merchant || !values.account || !values['api-key'] || !values.environment) {
  console.error(usage);
  process.exit(1);
}
if (!/^\d+$/.test(values.account)) { console.error('--account must be numbers only'); process.exit(1); }
if (!['sandbox', 'live'].includes(values.environment)) { console.error('--environment must be sandbox or live'); process.exit(1); }
if (values.fee && !['customer_pay', 'split', 'merchant_absorb'].includes(values.fee)) { console.error('--fee must be customer_pay, split or merchant_absorb'); process.exit(1); }
if (values.currency && !/^[A-Z]{3}$/.test(values.currency)) { console.error('--currency must be 3 capital letters, e.g. XCD'); process.exit(1); }

try {
  const { rowCount } = await pool.query(
    `UPDATE merchants
        SET wipay_account_number = $2, wipay_api_key_enc = $3, wipay_environment = $4,
            fee_structure = COALESCE($5, fee_structure), currency = COALESCE($6, currency), updated_at = NOW()
      WHERE LOWER(name) = LOWER($1)`,
    [values.merchant, values.account, encrypt(values['api-key']), values.environment, values.fee || null, values.currency || null]
  );
  if (!rowCount) {
    console.error(`No merchant named "${values.merchant}". Create it first with npm run site:create`);
    process.exitCode = 1;
  } else {
    console.log(`Saved WiPay details for "${values.merchant}" (${values.environment}). API key stored encrypted.`);
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
