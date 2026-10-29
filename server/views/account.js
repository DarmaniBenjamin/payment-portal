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
