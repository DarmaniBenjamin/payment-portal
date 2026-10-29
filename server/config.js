// Checks the settings the service needs before it starts, so a bad setup fails loudly
// instead of half-working. In production (NODE_ENV=production) the rules are stricter.
export function checkConfig(env = process.env) {
  const problems = [];
  const production = env.NODE_ENV === 'production';

  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set.');
  if (!env.PUBLIC_URL) problems.push('PUBLIC_URL is not set (e.g. https://pay.yourdomain.com).');
  else {
    try {
      const u = new URL(env.PUBLIC_URL);
      if (production && u.protocol !== 'https:') problems.push('PUBLIC_URL must start with https:// in production.');
    } catch {
      problems.push('PUBLIC_URL is not a valid address.');
    }
  }
  if (!env.ENCRYPTION_KEY || Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) {
    problems.push('ENCRYPTION_KEY must be 32 bytes in base64 (generate one with: npm run -s gen:key).');
  }

  if (production) {
    if (env.WIPAY_BASE_URL) problems.push('WIPAY_BASE_URL must be empty in production (it points payments at the test mock).');
    if (!env.SMTP_HOST) problems.push('SMTP_HOST is not set: invites, password links and access alerts could not be emailed.');
    if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 24) problems.push('SETUP_TOKEN must be at least 24 characters (or removed once setup is done).');
  }
  return problems;
}
