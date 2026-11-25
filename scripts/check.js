'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json', 'capacitor.config.json', 'README.md',
  'src/main/server.js', 'src/main/electron.js', 'src/main/preload.js',
  'src/main/discovery.js', 'src/main/udpVoice.js', 'src/main/storage.js',
  'src/shared/constants.js', 'src/shared/validate.js',
  'src/renderer/index.html', 'src/renderer/styles/adwaita.css', 'src/renderer/styles/app.css',
  'src/renderer/styles/polish.css', 'src/renderer/styles/gnome.css',
  'src/renderer/js/app.js', 'src/renderer/js/net.js', 'src/renderer/js/url.js', 'src/renderer/js/voice.js',
  'src/renderer/js/settingsBackup.js',
  'src/renderer/js/micEV.js', 'src/renderer/js/worklets/pcm-capture.js',
  'src/renderer/js/worklets/pcm-playback.js', 'build/icons/icon.ico',
  'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/java/com/wasel/call/MainActivity.java',
  'docs/ANDROID.md'
];

let failures = 0;
function fail(message) { failures++; console.error('  [FAIL] ' + message); }
function pass(message) { console.log('  [OK]   ' + message); }

console.log('مكالمات واصل — فحص المشروع');

for (const rel of required) {
  const target = path.join(root, rel);
  if (fs.existsSync(target)) pass(rel);
  else fail('missing: ' + rel);
}

for (const rel of ['package.json', 'capacitor.config.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    pass(rel + ' valid JSON');
  } catch (e) { fail(rel + ': ' + e.message); }
}

const cjs = [
  'src/main/server.js', 'src/main/electron.js', 'src/main/preload.js',
  'src/main/discovery.js', 'src/main/udpVoice.js', 'src/main/storage.js',
  'src/main/networkName.js', 'src/shared/constants.js', 'src/shared/validate.js',
  'scripts/build-apk.js', 'scripts/build-mobile.js'
];
for (const rel of cjs) {
  const target = path.join(root, rel);
  if (!fs.existsSync(target)) continue;
  const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (result.status === 0) pass(rel + ' syntax');
  else fail(rel + ': ' + String(result.stderr || '').slice(0, 400));
}

const esm = [
  'src/renderer/js/app.js', 'src/renderer/js/auth.js', 'src/renderer/js/bridge.js',
  'src/renderer/js/chat.js', 'src/renderer/js/files.js', 'src/renderer/js/i18n.js',
  'src/renderer/js/icons.js', 'src/renderer/js/micEV.js', 'src/renderer/js/net.js',
  'src/renderer/js/profile.js', 'src/renderer/js/rooms.js', 'src/renderer/js/settingsBackup.js',
  'src/renderer/js/theme.js', 'src/renderer/js/ui.js', 'src/renderer/js/voice.js'
];
for (const rel of esm) {
  const target = path.join(root, rel);
  if (!fs.existsSync(target)) continue;
  const source = fs.readFileSync(target, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
  if (result.status === 0) pass(rel + ' syntax');
  else fail(rel + ': ' + String(result.stderr || '').slice(0, 400));
}

if (fs.existsSync(path.join(root, 'node_modules'))) pass('node_modules installed');
else console.log('  [INFO] node_modules not installed — run npm install');

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
