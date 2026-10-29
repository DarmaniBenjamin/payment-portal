// Encryption for secrets we must be able to read back later (e.g. WiPay API keys),
// and hashing for secrets we only need to check (e.g. site API keys).
import crypto from 'node:crypto';

const raw = process.env.ENCRYPTION_KEY || '';
const KEY = Buffer.from(raw, 'base64');

if (KEY.length !== 32) {
  console.error('ENCRYPTION_KEY must be 32 bytes in base64. Generate one with: npm run -s gen:key');
  process.exit(1);
}

// AES-256-GCM: stored as "v1:<iv>:<tag>:<ciphertext>" (all base64)
export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(stored) {
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Site API keys: shown once when created, only the hash is saved
export function generateApiKey() {
  const key = 'pp_' + crypto.randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 10), hash: hashApiKey(key) };
}

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

export function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
