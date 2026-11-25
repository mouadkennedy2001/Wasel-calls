#!/usr/bin/env node
'use strict';

/*
 * Build the مكالمات واصل debug APK.
 * The script never tries to guess an SDK path: ANDROID_HOME or
 * ANDROID_SDK_ROOT must point to a real Android SDK installation.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const APP_DIR = path.join(ANDROID_DIR, 'app');
const APK = path.join(APP_DIR, 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const IS_WINDOWS = process.platform === 'win32';

function fail(english, arabic) {
  console.error('');
  console.error('[ERROR] ' + english);
  console.error('[خطأ] ' + arabic);
  console.error('');
  process.exit(1);
}

function run(command, args, cwd, label) {
  console.log('\n> ' + [command, ...args].join(' ') + '   (in ' + cwd + ')');
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: IS_WINDOWS,
  });

  if (result.error) {
    fail(
      'Could not run "' + command + '": ' + result.error.message,
      'تعذر تشغيل الأمر "' + command + '": ' + result.error.message
    );
  }
  if (result.status !== 0) {
    fail(
      label + ' failed with exit code ' + result.status + '.',
      'فشل ' + label + ' برمز الخروج ' + result.status + '.'
    );
  }
}

function main() {
  console.log('مكالمات واصل - Android debug APK builder');

  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) {
    fail(
      'Android SDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK folder and run again.',
      'لم يتم العثور على Android SDK. اضبط المتغير ANDROID_HOME (أو ANDROID_SDK_ROOT) على مجلد الـ SDK ثم أعد المحاولة.'
    );
  }
  if (!fs.existsSync(sdk) || !fs.statSync(sdk).isDirectory()) {
    fail(
      'The Android SDK path does not exist: ' + sdk,
      'مسار Android SDK غير موجود: ' + sdk
    );
  }

  if (!fs.existsSync(ANDROID_DIR)) {
    fail(
      'The android/ project folder is missing. Run "npx cap add android" first.',
      'مجلد مشروع android/ غير موجود. شغّل "npx cap add android" أولاً.'
    );
  }

  const npmCommand = IS_WINDOWS ? 'npx.cmd' : 'npx';
  run(npmCommand, ['cap', 'sync', 'android'], ROOT, 'Capacitor sync');

  const wrapper = IS_WINDOWS ? 'gradlew.bat' : 'gradlew';
  const wrapperPath = path.join(ANDROID_DIR, wrapper);
  const wrapperJar = path.join(ANDROID_DIR, 'gradle', 'wrapper', 'gradle-wrapper.jar');

  if (!fs.existsSync(wrapperPath)) {
    fail(
      'Missing ' + wrapper + '. Regenerate the platform with "npx cap add android" (save your custom files first).',
      'الملف ' + wrapper + ' غير موجود. أعد توليد المنصة باستخدام "npx cap add android" بعد حفظ ملفاتك المخصصة.'
    );
  }
  if (!fs.existsSync(wrapperJar)) {
    fail(
      'gradle/wrapper/gradle-wrapper.jar is missing. Regenerate the platform with "npx cap add android" or copy the jar from another Capacitor project.',
      'الملف gradle/wrapper/gradle-wrapper.jar غير موجود. أعد توليد المنصة باستخدام "npx cap add android" أو انسخ الملف من مشروع Capacitor آخر.'
    );
  }

  run(wrapperPath, ['assembleDebug'], ANDROID_DIR, 'Gradle assembleDebug');

  if (!fs.existsSync(APK)) {
    fail(
      'Gradle finished but the APK was not found at the expected path: ' + APK,
      'انتهى Gradle لكن لم يتم العثور على ملف APK في المسار المتوقع: ' + APK
    );
  }

  console.log('\n[SUCCESS] Debug APK: ' + APK);
  console.log('[نجاح] ملف APK التجريبي: ' + APK);
}

main();
