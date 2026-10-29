// Talks to WiPay's Payments API (hosted checkout).
// Docs: https://docs.wipayfinancial.com/payments-api
import crypto from 'node:crypto';
import { decrypt } from './crypto.js';

// WiPay's public sandbox test account (from their docs)
const SANDBOX_ACCOUNT = '1234567890';
const SANDBOX_API_KEY = '123';

// e.g. GD + sandbox -> https://gdsb.wipayfinancial.com/plugins
// WIPAY_BASE_URL in .env overrides this (only for the local mock).
export function wipayBaseUrl(countryCode, environment) {
  if (process.env.WIPAY_BASE_URL) return process.env.WIPAY_BASE_URL.replace(/\/$/, '');
  const cc = String(countryCode).toLowerCase();
  return `https://${cc}${environment === 'sandbox' ? 'sb' : ''}.wipayfinancial.com/plugins`;
}

// Account number + API key for a merchant (falls back to WiPay's test account in sandbox)
export function wipayCredentials(merchant) {
  if (merchant.wipay_environment === 'sandbox' && !merchant.wipay_account_number) {
    return { accountNumber: SANDBOX_ACCOUNT, apiKey: SANDBOX_API_KEY };
  }
  if (!merchant.wipay_account_number || !merchant.wipay_api_key_enc) {
    throw new Error('This merchant has no WiPay account set up yet');
  }
  return { accountNumber: merchant.wipay_account_number, apiKey: decrypt(merchant.wipay_api_key_enc) };
}

// WiPay wants totals with exactly 2 decimals, and the hash uses the same format
export const formatTotal = (amount) => Number(amount).toFixed(2);

// Asks WiPay for a checkout page. Returns { url, transactionId }.
export async function createCheckout({ merchant, orderId, total, customer, responseUrl, data }) {
  const { accountNumber } = wipayCredentials(merchant);

  const body = {
    account_number: Number(accountNumber),
    country_code: merchant.country_code,
    currency: merchant.currency,
    environment: merchant.wipay_environment,
    fee_structure: merchant.fee_structure,
    method: 'credit_card_co',
    order_id: orderId,
    origin: 'PaymentPortal',
    response_url: responseUrl,
    total: Number(formatTotal(total)),
    email: customer.email,
    version: '0.1.0',
  };
  if (customer.name) body.name = customer.name.slice(0, 60);
  if (customer.phone && /^\+[1-9]\d{1,14}$/.test(customer.phone)) body.phone = customer.phone;
  if (data) body.data = JSON.stringify(data).slice(0, 4096);

  const res = await fetch(`${wipayBaseUrl(merchant.country_code, merchant.wipay_environment)}/payments/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  let result;
  try {
    result = await res.json();
  } catch {
    throw new Error(`WiPay returned an unexpected response (HTTP ${res.status})`);
  }
  if (!res.ok || result.message !== 'OK' || !result.url) {
    throw new Error(`WiPay rejected the request: ${result.message || `HTTP ${res.status}`}`);
  }
  return { url: result.url, transactionId: result.transaction_id };
}

// Checks the hash WiPay sends back on success:
// md5(transaction_id + original_total + api_key), using OUR total, not theirs.
export function verifyResponseHash({ transactionId, originalTotal, hash, apiKey }) {
  if (!transactionId || !hash) return false;
  const expected = crypto
    .createHash('md5')
    .update(String(transactionId) + formatTotal(originalTotal) + String(apiKey))
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(hash).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
