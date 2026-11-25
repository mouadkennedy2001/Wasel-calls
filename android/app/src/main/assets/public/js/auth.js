import { bridge } from './bridge.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc, $, toast } from './ui.js';

let mode = 'login';

export function showAuth(onSuccess) {
  const root = document.getElementById('app-root');
  root.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'auth-screen';
  screen.innerHTML =
    '<div class="auth-card">' +
      '<div class="auth-logo">' + icon('phone', 'icon-lg') + '</div>' +
      '<h1 class="auth-title">' + esc(t('appName')) + '</h1>' +
      '<p class="auth-subtitle">' + esc(t('tagline')) + '</p>' +
      '<div class="auth-tabs">' +
        '<button type="button" class="btn ghost" data-auth-mode="login">' + esc(t('login')) + '</button>' +
        '<button type="button" class="btn ghost" data-auth-mode="signup">' + esc(t('signup')) + '</button>' +
      '</div>' +
      '<form class="auth-form" autocomplete="off"></form>' +
      '<p class="field-hint">' + icon('shield') + ' ' + esc(t('localOnly')) + ' · ' + esc(t('offlineReady')) + '</p>' +
    '</div>';
  root.appendChild(screen);
  const form = $('form', screen);

  function render() {
    $('[data-auth-mode="login"]', screen).classList.toggle('primary', mode === 'login');
    $('[data-auth-mode="signup"]', screen).classList.toggle('primary', mode === 'signup');
    form.innerHTML =
      '<div class="field"><label for="auth-user">' + esc(t('username')) + '</label>' +
        '<input id="auth-user" name="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="' + esc(t('username')) + '"></div>' +
      (mode === 'signup' ? '<div class="field"><label for="auth-display">' + esc(t('displayName')) + '</label>' +
        '<input id="auth-display" name="displayName" maxlength="48" placeholder="' + esc(t('displayName')) + '"></div>' : '') +
      '<div class="field"><label for="auth-pass">' + esc(t('password')) + '</label>' +
        '<input id="auth-pass" name="password" type="password" required minlength="6" maxlength="128" autocomplete="' + (mode === 'login' ? 'current-password' : 'new-password') + '"></div>' +
      (mode === 'signup' ? '<div class="field"><label for="auth-confirm">' + esc(t('confirmPassword')) + '</label>' +
        '<input id="auth-confirm" name="confirm" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></div>' : '') +
      '<p class="auth-error hidden"></p>' +
      '<button class="btn primary" type="submit">' + icon('arrow-left') + ' ' + esc(mode === 'login' ? t('login') : t('createAccount')) + '</button>' +
      '<button class="btn ghost" type="button" data-auth-switch>' + esc(mode === 'login' ? t('noAccount') + ' ' + t('signup') : t('haveAccount') + ' ' + t('login')) + '</button>';
  }

  screen.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-auth-mode]');
    if (tab) { mode = tab.dataset.authMode; render(); return; }
    if (e.target.closest('[data-auth-switch]')) { mode = mode === 'login' ? 'signup' : 'login'; render(); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorNode = $('.auth-error', form);
    errorNode.classList.add('hidden');
    const data = new FormData(form);
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    try {
      let result;
      if (mode === 'signup') {
        if (password !== String(data.get('confirm') || '')) throw new Error(t('passwordMismatch'));
        result = await bridge.auth.signup(username, password, { displayName: String(data.get('displayName') || '').trim() || username });
        toast(t('success'), 'success');
      } else {
        result = await bridge.auth.login(username, password);
      }
      onSuccess(result);
    } catch (err) {
      errorNode.textContent = err && err.message ? err.message : t('failure');
      errorNode.classList.remove('hidden');
    }
  });

  render();
  setTimeout(() => $('#auth-user', form)?.focus(), 60);
}

export async function listAccounts() {
  try { return await bridge.auth.accounts(); } catch (_) { return []; }
}
