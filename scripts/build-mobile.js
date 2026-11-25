'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args) {
  const result = spawnSync(npx, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(args.join(' ') + ' failed');
}

console.log('مكالمات واصل — تحضير نسخة الجوال / preparing mobile build');
if (!fs.existsSync(path.join(root, 'android'))) {
  console.error('android/ غير موجود. شغّل: npx cap add android');
  process.exit(1);
}
try {
  run(['cap', 'copy', 'android']);
  run(['cap', 'sync', 'android']);
  console.log('\nتم نسخ ملفات التطبيق إلى android/app/src/main/assets/public');
  console.log('افتح android/ في Android Studio وابنِ APK، أو شغّل: npm run apk');
} catch (err) {
  console.error('فشل التحضير: ' + err.message);
  process.exit(1);
}
