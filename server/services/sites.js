// Rules for connected sites, shared by the dashboard and the terminal scripts.

// Webhook URLs must be https (http only for localhost while testing). Returns { url } or { error }.
export function checkWebhookUrl(value) {
  if (value == null || String(value).trim() === '') return { url: null };
  try {
    const u = new URL(String(value).trim());
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error();
    return { url: u.toString() };
  } catch {
    return { error: 'Webhook URL must be a full https:// address (http:// only for localhost testing)' };
  }
}

// Site addresses (optional) just need to be a real http(s) URL
export function checkSiteUrl(value) {
  if (value == null || String(value).trim() === '') return { url: null };
  try {
    const u = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return { url: u.toString() };
  } catch {
    return { error: 'Site address must be a full URL, like https://example.com' };
  }
}

export const SITE_TYPES = ['wordpress', 'static', 'app'];
