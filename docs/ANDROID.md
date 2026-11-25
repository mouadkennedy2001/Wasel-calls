# تطبيق أندرويد — مكالمات واصل

> الإصدار المستهدف: **Capacitor 8.6.2** (`@capacitor/*: ^8.6.2`).
> يتطلب Capacitor 8 إصدار **Node.js 22+** و **Android Studio Otter | 2025.2.1** أو أحدث.
> إعدادات Gradle المطابقة: AGP `8.13.0`، Gradle wrapper `8.14.3`، `compileSdk/targetSdk = 36`، `minSdk = 24`.

## الخطوات (العربية)

1. ثبّت الحزم وابنِ نسخة الويب:

   ```bash
   npm install
   npm run build:mobile
   ```

   (`build:mobile` يجب أن يبني ملفات `src/renderer` كما هي؛ لا يتم استخدام `server.url`، بل تُحمّل الأصول محليًا داخل التطبيق.)

2. حدّث مشروع أندرويد — انسخ إعدادات Capacitor وأصول الويب:

   ```bash
   npx cap sync android
   ```

   هذا الأمر ينشئ/يحدّث الملفات المولّدة (`capacitor.settings.gradle`, `capacitor.build.gradle`, `capacitor.plugins.json`, `app/src/main/assets/public`)، وهو الطريقة الموثوقة لإعادة توليد مجلد `android/` إذا حدث أي خلل.

3. افتح المشروع في Android Studio:

   ```bash
   npx cap open android
   ```

   أو افتح مجلد `android/` مباشرةً من Android Studio وانتظر مزامنة Gradle.

4. ابنِ APK تجريبي:
   - من Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**،
   - أو من سطر الأوامر (بعد ضبط `ANDROID_HOME`): `node scripts/build-apk.js`.

   الناتج: `android/app/build/outputs/apk/debug/app-debug.apk`.

### ملاحظة مهمة عن Gradle wrapper

ملف `gradle/wrapper/gradle-wrapper.jar` ثنائي ولا يمكن إضافته كنص هنا، لذلك يوجد ملف الخصائص `gradle/wrapper/gradle-wrapper.properties` فقط. عند أول فتح المشروع، إن اشتكى Gradle من غياب الـ jar، احذف مجلد `android/` وأعد توليده بالأمر الرسمي (مع حفظ `MainActivity.java` و`WaselDiscoveryPlugin.java` أولاً):

```bash
npx cap add android
```

ثم أعد تطبيق ملفاتك المخصصة وشغّل `npx cap sync android`.

## اكتشاف الأجهزة على الموبايل (UDP)

متصفح WebView داخل Capacitor **لا يملك مقابس UDP**، لذا لا يمكن لحمولة JavaScript أن تبثّ حزم اكتشاف UDP كما يفعل تطبيق Electron/سطح المكتب. الحلول العملية:

- حل بسيط: أدخل عنوان IP الخاص بخادم `wasel-call` يدويًا (`http://<ip>:7788`) واتصل عبر WebSocket على `/ws`.
- متقدم: plugin أصلي `WaselDiscovery` (موجود في `android/app/src/main/java/com/wasel/call/plugins/WaselDiscoveryPlugin.java`) يوفّر اسم الشبكة (SSID) ونوع الواجهة (wifi/ethernet) وعنوان IP المحلي عبر:

  ```js
  const { ssid, interfaceType, localIp } =
    await Capacitor.Plugins.WaselDiscovery.getWifiInfo();
  ```

  يمكن توسيع هذا Plugin لاحقًا ببثّ UDP حقيقي من جانب أندرويد (باستخدام `DatagramSocket` داخل خدمة) وإعادة النتائج إلى الويب عبر plugin events. الإعداد في `capacitor.config.json` هو مجرد عنصر نائب (`placeholder`) لهذا التوسيع.

> ملاحظة الخصوصية: على أندرويد 13+ يعيد الـ plugin قيمة `ssid` فارغة إذا لم تكن صلاحية `ACCESS_FINE_LOCATION` أو `NEARBY_WIFI_DEVICES` ممنوحة. يعالج Plugin ذلك بأمان دون إظهار خطأ.

## الصلاحيات وحركة الشبكة

- `RECORD_AUDIO` مطلوب للمكالمات الصوتية؛ يطلبه التطبيق وقت التشغيل (Android 6+). بدون هذه الصلاحية لا يعمل الميكروفون.
- `POST_NOTIFICATIONS` مطلوب على أندرويد 13+ لإظهار إشعار المكالمة/الخدمة في المقدمة (`FOREGROUND_SERVICE`).
- `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` مطلوبة للاتصال بالخادم ومعرفة حالة الشبكة.
- `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` مضافان للإصدارات القديمة فقط (`maxSdkVersion`).
- `android:usesCleartextTraffic="true"` و`android.allowMixedContent` مفعّلان لأن خادم LAN يعمل على `http://` (منفذ 7788) وليس HTTPS. هذا مقبول داخل شبكة محلية موثوقة؛ لا تستخدمه على شبكات عامة.

## الأيقونات

```bash
python scripts/make-icons.py
```

يولّد الملفات في `build/icons/` (512/192/48 PNG، أيقونة مربعة، و`icon.ico`) باستخدام Python القياسي فقط — لا حاجة لـ Pillow. انسخها إلى مجلدات `mipmap-*` في أندرويد عند الحاجة.

---

## English (brief)

1. `npm install` then `npm run build:mobile`.
2. `npx cap sync android` (regenerates Capacitor's Gradle glue files and copies `src/renderer` into the app assets — no `server.url` is used).
3. `npx cap open android` (or open `android/` in Android Studio; AGP 8.13.0 / Gradle 8.14.3).
4. **Build → Build Bundle(s) / APK(s) → Build APK(s)**, or run `node scripts/build-apk.js` with `ANDROID_HOME` set. APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

The WebView has **no UDP sockets**, so browser-side UDP discovery is impossible on mobile. Either type the LAN server IP manually (`http://<ip>:7788`) or extend the included `WaselDiscovery` native plugin with a `DatagramSocket` and forward results to the web app. The plugin currently returns `ssid` (empty when the Android 13+ permission is missing), `interfaceType` and `localIp`.

Microphone (`RECORD_AUDIO`), notifications (`POST_NOTIFICATIONS` on Android 13+), and foreground service permissions are declared. Cleartext LAN HTTP is enabled via `usesCleartextTraffic` and `allowMixedContent` because the server listens on plain HTTP port 7788.
