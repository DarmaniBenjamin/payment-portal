// Pages for setting a password from an emailed link, and for "forgot password".
import { esc } from './payPage.js';
import { page } from './admin.js';

const box = (title, sub, inner) => page(title, `<div class="login">
<h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}
<div class="card">${inner}</div>
<p class="linkrow"><a href="/admin/login">Back to log in</a></p></div>`);

export function forgotPage({ error, email = '' } = {}) {
  return box('Forgot password', 'We’ll email you a link to choose a new one.', `
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/forgot">
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${esc(email)}"></div>
<button class="btn block" type="submit">Email me a link</button></form>`);
}

export function forgotSentPage() {
  return box('Check your email', '', `<p style="margin:0">If that email has a login, a link to choose a new password is on its way. The link works once and expires in 1 hour.</p>`);
}

export function setPasswordPage({ token, who, purpose, error }) {
  const title = purpose === 'invite' ? 'Set up your login' : 'Choose a new password';
  return box(title, `For ${esc(who.email)}`, `
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/set-password">
<input type="hidden" name="token" value="${esc(token)}">
<input type="text" name="username" value="${esc(who.email)}" autocomplete="username" hidden>
<div class="field"><label for="pw">New password</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="12" required autofocus><div class="hint">At least 12 characters. Only you will know it.</div></div>
<div class="field"><label for="pw2">Repeat password</label><input id="pw2" name="confirm" type="password" autocomplete="new-password" minlength="12" required></div>
<button class="btn block" type="submit">${purpose === 'invite' ? 'Set password and log in' : 'Save new password'}</button></form>`);
}

export function linkInvalidPage() {
  return box('Link not valid', '', `<p style="margin:0">This link has expired or was already used. You can <a href="/admin/forgot">request a new one</a>, or ask the platform team to resend your invite.</p>`);
}

// One-time setup on a new server: creates the platform business and its first login
export function setupPage({ token, values = {}, error }) {
  const v = (k) => esc(values[k] ?? '');
  return box('First-time setup', 'Creates the platform account (e.g. Protonic) and your login. This page switches itself off afterwards.', `
${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/setup">
<input type="hidden" name="token" value="${esc(token)}">
<div class="field"><label for="biz">Platform business name</label><input id="biz" name="business_name" maxlength="80" required value="${v('business_name')}" placeholder="e.g. Protonic Solutions"></div>
<div class="field"><label for="bizmail">Business email</label><input id="bizmail" name="business_email" type="email" maxlength="80" required value="${v('business_email')}"></div>
<div class="field"><label for="name">Your name</label><input id="name" name="name" maxlength="60" required value="${v('name')}"></div>
<div class="field"><label for="email">Your login email</label><input id="email" name="email" type="email" autocomplete="username" maxlength="80" required value="${v('email')}"></div>
<div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="12" required><div class="hint">At least 12 characters</div></div>
<div class="field"><label for="pw2">Repeat password</label><input id="pw2" name="confirm" type="password" autocomplete="new-password" minlength="12" required></div>
<button class="btn block" type="submit">Create platform account</button></form>`);
}

export function setupClosedPage(reason) {
  return box('Setup not available', '', `<p style="margin:0">${esc(reason)}</p>`);
}
