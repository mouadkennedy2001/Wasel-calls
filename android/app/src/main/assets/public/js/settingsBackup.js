import { bridge } from './bridge.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { THEMES, applyTheme, setAccent } from './theme.js';
import { setLanguage } from './i18n.js';

const KEYS = ['theme', 'accent', 'language', 'voiceMode', 'micSensitivity', 'noiseGate', 'echoCancel', 'minimizeToTray', 'volume', 'lastRoom', 'host', 'deviceId'];
const FORMAT = 'wasel-call-settings';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function sanitize(input) {
  const out = {};
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (key === 'theme') out.theme = THEMES.some((x) => x.id === value) ? value : 'adwaita-dark';
    else if (key === 'accent') out.accent = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '';
    else if (key === 'language') out.language = value === 'en' ? 'en' : 'ar';
    else if (key === 'voiceMode') out.voiceMode = ['auto', 'webrtc', 'udp'].includes(value) ? value : 'auto';
    else if (key === 'micSensitivity' || key === 'volume') out[key] = clamp(value, 0, 1, 0.5);
    else if (['noiseGate', 'echoCancel', 'minimizeToTray'].includes(key)) out[key] = value === true;
    else out[key] = typeof value === 'string' ? value.slice(0, 128) : '';
  }
  return out;
}

export async function exportSettings() {
  const settings = {};
  for (const key of KEYS) settings[key] = await bridge.store.get(key, '').catch(() => '');
  const payload = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `wasel-call-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(t('settingsExported'), 'success');
}

export function importSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 64 * 1024) { toast(t('settingsFileInvalid'), 'error'); return; }
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.format !== FORMAT || !data.settings || typeof data.settings !== 'object') throw new Error('bad format');
      const settings = sanitize(data.settings);
      for (const [key, value] of Object.entries(settings)) await bridge.store.set(key, value);
      if (settings.theme) applyTheme(settings.theme, false);
      if (settings.accent !== undefined) setAccent(settings.accent, false);
      if (settings.language) setLanguage(settings.language);
      toast(t('settingsImported'), 'success');
      setTimeout(() => location.reload(), 500);
    } catch (_) {
      toast(t('settingsFileInvalid'), 'error');
    }
  });
  input.click();
}
