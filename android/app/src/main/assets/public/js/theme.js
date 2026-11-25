import { bridge } from './bridge.js';
import { t } from './i18n.js';
import { esc } from './ui.js';

export const THEMES = [
  { id: 'auto', label: 'تلقائي', swatch: ['#1e1e20', '#3584e4'] },
  { id: 'adwaita-dark', label: 'Adwaita Dark', swatch: ['#1e1e20', '#3584e4'] },
  { id: 'adwaita-light', label: 'Adwaita Light', swatch: ['#f6f5f4', '#3584e4'] },
  { id: 'yaru', label: 'Yaru', swatch: ['#f6f5f4', '#e95420'] },
  { id: 'yaru-dark', label: 'Yaru Dark', swatch: ['#1d1d1d', '#e95420'] },
  { id: 'pop-dark', label: 'Pop!_OS', swatch: ['#171717', '#48b9c7'] },
  { id: 'nord', label: 'Nord', swatch: ['#2e3440', '#88c0d0'] },
  { id: 'dracula', label: 'Dracula', swatch: ['#282a36', '#bd93f9'] },
  { id: 'solarized-light', label: 'Solarized Light', swatch: ['#fdf6e3', '#268bd2'] },
  { id: 'solarized-dark', label: 'Solarized Dark', swatch: ['#002b36', '#2aa198'] },
  { id: 'black', label: 'Black', swatch: ['#000000', '#3584e4'] },
  { id: 'high-contrast-light', label: 'High Contrast Light', swatch: ['#ffffff', '#0000cc'] },
  { id: 'high-contrast-dark', label: 'High Contrast Dark', swatch: ['#000000', '#ffff00'] },
  { id: 'catppuccin', label: 'Catppuccin Mocha', swatch: ['#1e1e2e', '#cba6f7'] },
  { id: 'catppuccin-light', label: 'Catppuccin Latte', swatch: ['#eff1f5', '#8839ef'] },
  { id: 'rose-pine', label: 'Rosé Pine', swatch: ['#191724', '#ebbcba'] },
  { id: 'fedora', label: 'Fedora', swatch: ['#252525', '#294172'] },
  { id: 'windows-light', label: 'Windows Light', swatch: ['#f3f3f3', '#0067c0'] },
  { id: 'windows-dark', label: 'Windows Dark', swatch: ['#202020', '#4cc2ff'] }
];

let currentTheme = 'adwaita-dark';
let systemTheme = 'dark';
let accent = '';

function resolve(id) {
  if (id !== 'auto') return id;
  return systemTheme === 'light' ? 'adwaita-light' : 'adwaita-dark';
}

export function applyTheme(id, persist) {
  currentTheme = THEMES.some((x) => x.id === id) ? id : 'adwaita-dark';
  document.documentElement.classList.remove(...THEMES.map((x) => 'theme-' + x.id));
  document.documentElement.classList.add('theme-' + resolve(currentTheme));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1e1e20');
  if (persist !== false) bridge.store.set('theme', currentTheme).catch(() => {});
}

export function setAccent(color, persist) {
  accent = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '';
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  else document.documentElement.style.removeProperty('--accent');
  if (persist !== false) bridge.store.set('accent', accent).catch(() => {});
}

export async function initTheme() {
  try {
    const stored = await bridge.store.get('theme', 'adwaita-dark');
    currentTheme = THEMES.some((x) => x.id === stored) ? stored : 'adwaita-dark';
    accent = await bridge.store.get('accent', '');
  } catch (_) { /* storage unavailable */ }
  systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  bridge.theme.onSystem((value) => {
    systemTheme = value;
    if (currentTheme === 'auto') applyTheme('auto', false);
  });
  applyTheme(currentTheme, false);
  setAccent(accent, false);
}

export function getTheme() { return currentTheme; }
export function getAccent() { return accent; }

export function themeGrid(activeId) {
  return '<div class="theme-grid">' + THEMES.map((item) =>
    '<button class="theme-card ' + (item.id === activeId ? 'active' : '') + '" data-theme="' + esc(item.id) + '" type="button">' +
    '<span class="theme-swatch" style="background:' + esc(item.swatch[0]) + ';border-color:' + esc(item.swatch[1]) + '"><i style="background:' + esc(item.swatch[1]) + '"></i></span>' +
    '<span class="theme-name">' + esc(item.id === 'auto' ? t('autoTheme') : item.label) + '</span></button>'
  ).join('') + '</div>';
}
