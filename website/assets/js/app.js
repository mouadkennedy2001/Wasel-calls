/* واصل كولز — منطق الموقع الثابت
   - ثنائي اللغة (عربي/إنجليزي) مع اتجاه RTL/LTR وخطوط محلية
   - جلب أحدث إصدار مستقر وإحصائيات المستودع من GitHub API
   - بيانات احتياطية + تخزين مؤقت للعمل دون اتصال
   - مظهر GNOME، تنقّل، عدّادات، بحث في الإصدارات، نسخ البصمة */
(() => {
  'use strict';

  const REPO = 'mouadkennedy2001/Wasel-calls';
  const API = 'https://api.github.com';
  const RELEASES_URL = `https://github.com/${REPO}/releases`;
  const CACHE_KEY = 'wasel:github-cache';
  const LANG_KEY = 'wasel:lang';
  const CACHE_TTL = 10 * 60 * 1000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const I18N = {
    ar: {
      title: 'واصل كولز | مكالمات ومحادثات على شبكتك المحلية',
      description: 'واصل كولز — محادثة ومكالمات صوتية ومشاركة ملفات على الشبكة المحلية، بواجهة GNOME/Adwaita عصرية. حمّل أحدث إصدار مستقر.',
      ogLocale: 'ar_AR',
      syncLoading: 'جارٍ مزامنة الإصدارات…',
      syncLive: 'تم التحديث تلقائياً من GitHub الآن',
      syncCached: 'آخر تحديث من GitHub محفوظ محلياً',
      syncStale: 'تعذّر الاتصال بـ GitHub — عرض بيانات مخزّنة',
      syncFallback: 'عرض بيانات احتياطية — GitHub غير متاح حالياً',
      latestStable: 'أحدث مستقر',
      releasePage: 'صفحة التحميل',
      noNotes: 'لا توجد ملاحظات مُرفقة بهذا الإصدار.',
      noAssets: 'لا توجد ملفات قابلة للتحميل في هذا الإصدار؛ افتح صفحة الإصدار على GitHub.',
      downloads: 'تحميل',
      copyLink: 'رابط',
      preRelease: 'تجريبي',
      downloadApk: 'تنزيل APK',
      downloadRelease: 'تنزيل الإصدار',
      noSearch: 'لا توجد إصدارات مطابقة لبحثك.',
      copied: 'تم النسخ: ',
      copyFail: 'تعذّر النسخ، انسخ النص يدوياً',
      starsOnGithub: (n) => `${n} نجمة على GitHub — افتح المستودع`,
      theme: { system: 'تلقائي', dark: 'داكن', light: 'فاتح' },
      languageToast: 'اللغة: العربية',
      backToTop: 'العودة إلى الأعلى'
    },
    en: {
      title: 'Wasel Calls | Local-first chat and voice calls',
      description: 'Wasel Calls — local chat, voice calls and file sharing with a modern GNOME/Adwaita interface. Download the latest stable release.',
      ogLocale: 'en_US',
      syncLoading: 'Syncing releases…',
      syncLive: 'Synced from GitHub just now',
      syncCached: 'Last GitHub update saved locally',
      syncStale: 'GitHub unreachable — showing cached data',
      syncFallback: 'Showing built-in fallback — GitHub is unavailable',
      latestStable: 'Latest stable',
      releasePage: 'Open release page',
      noNotes: 'No notes attached to this release.',
      noAssets: 'No downloadable assets in this release; open it on GitHub.',
      downloads: 'downloads',
      copyLink: 'Link',
      preRelease: 'Pre-release',
      downloadApk: 'Download APK',
      downloadRelease: 'Download release',
      noSearch: 'No releases match your search.',
      copied: 'Copied: ',
      copyFail: 'Copy failed — select the text manually',
      starsOnGithub: (n) => `${n} stars on GitHub — open the repository`,
      theme: { system: 'Automatic', dark: 'Dark', light: 'Light' },
      languageToast: 'Language: English',
      backToTop: 'Back to top'
    }
  };

  let currentLang = 'ar';
  let nf = new Intl.NumberFormat('ar-u-nu-latn');
  let df = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  let rtf = makeRelativeFormatter('ar');

  function makeRelativeFormatter(lang) {
    try {
      return new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en', { numeric: 'auto', style: 'short' });
    } catch { return null; }
  }

  const t = (key) => I18N[currentLang][key] ?? key;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const safeUrl = (url) => (/^https:\/\/github\.com\//i.test(String(url || '')) ? String(url) : RELEASES_URL);
  const safeAssetUrl = (asset) => /^https:\/\/github\.com\//i.test(String(asset?.browser_download_url || ''));

  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : df.format(date);
  };

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || !rtf) return '';
    const seconds = (date.getTime() - Date.now()) / 1000;
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return rtf.format(0, 'minute');
  }

  const formatBytes = (bytes) => {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
    return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const semver = (tag) => {
    const match = String(tag || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : [0, 0, 0];
  };

  const compareVersions = (a, b) => {
    const x = semver(a);
    const y = semver(b);
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  };

  /* --------------------------------------------------------- الترجمة */

  const staticNodes = [];

  function collectStaticNodes() {
    $$('[data-en], [data-en-html], [data-en-aria], [data-en-title], [data-en-placeholder]').forEach((node) => {
      if (node.hasAttribute('data-en') && !node.dataset.ar) node.dataset.ar = node.textContent;
      if (node.hasAttribute('data-en-html') && !node.dataset.arHtml) node.dataset.arHtml = node.innerHTML;
      if (node.hasAttribute('data-en-aria') && !node.dataset.arAria) node.dataset.arAria = node.getAttribute('aria-label') || '';
      if (node.hasAttribute('data-en-title') && !node.dataset.arTitle) node.dataset.arTitle = node.getAttribute('title') || '';
      if (node.hasAttribute('data-en-placeholder') && !node.dataset.arPlaceholder) node.dataset.arPlaceholder = node.getAttribute('placeholder') || '';
      staticNodes.push(node);
    });
  }

  function applyStaticLanguage() {
    const en = currentLang === 'en';
    staticNodes.forEach((node) => {
      if (node.hasAttribute('data-en')) node.textContent = en ? node.dataset.en : node.dataset.ar;
      if (node.hasAttribute('data-en-html')) node.innerHTML = en ? node.dataset.enHtml : node.dataset.arHtml;
      if (node.hasAttribute('data-en-aria')) node.setAttribute('aria-label', en ? node.dataset.enAria : node.dataset.arAria);
      if (node.hasAttribute('data-en-title')) node.setAttribute('title', en ? node.dataset.enTitle : node.dataset.arTitle);
      if (node.hasAttribute('data-en-placeholder')) node.setAttribute('placeholder', en ? node.dataset.enPlaceholder : node.dataset.arPlaceholder);
    });

    $$('[data-lang]').forEach((button) => {
      const active = button.dataset.lang === currentLang;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    window.dispatchEvent(new Event('wasel:langchange'));
  }

  // يحدّث نصاً كان ثابتاً في HTML وأصبح ديناميكياً من GitHub.
  function setTranslated(node, ar, en) {
    if (!node) return;
    if (node.hasAttribute('data-en')) {
      node.dataset.ar = ar;
      node.dataset.en = en;
    }
    node.textContent = currentLang === 'ar' ? ar : en;
  }

  function refreshStatFormats() {
    $$('#stat-stars, #stat-downloads, #stat-releases, #stat-platforms').forEach((node) => {
      if (node?.dataset.value) node.textContent = nf.format(Number(node.dataset.value));
    });
  }

  let currentData = null;
  let currentReleases = [];
  let currentLatest = null;
  let releaseQuery = '';
  let lastSync = null;

  function setLang(lang, persist = true) {
    if (!I18N[lang]) return;
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    nf = new Intl.NumberFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US');
    df = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    rtf = makeRelativeFormatter(lang);

    applyStaticLanguage();
    document.title = t('title');
    $('meta[name="description"]')?.setAttribute('content', t('description'));
    $('meta[property="og:locale"]')?.setAttribute('content', t('ogLocale'));
    $('#to-top')?.setAttribute('aria-label', t('backToTop'));

    if (persist) {
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* تخزين غير متاح */ }
    }

    if (currentData) {
      renderLatest(currentLatest);
      renderOlder(currentReleases, currentLatest, releaseQuery);
      refreshStatFormats();
      const starCount = $('#star-count');
      if (starCount) starCount.textContent = nf.format(Number(currentData.repo?.stargazers_count) || 0);
      $('#star-link')?.setAttribute('aria-label', t('starsOnGithub')(nf.format(Number(currentData.repo?.stargazers_count) || 0)));
    }
    if (lastSync) setSync(lastSync.key, lastSync.state);
  }

  function initI18n() {
    collectStaticNodes();
    let stored = null;
    try { stored = localStorage.getItem(LANG_KEY); } catch { /* تجاهل */ }
    setLang(stored === 'en' ? 'en' : 'ar', false);

    $$('[data-lang]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.lang === currentLang) return;
        setLang(button.dataset.lang);
        showToast(t('languageToast'));
      });
    });
  }

  /* ------------------------------------------------------------ المظهر */

  function initTheme() {
    const button = $('#theme-toggle');
    const use = $('#theme-toggle use');
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const stored = (() => {
      try { return localStorage.getItem('wasel-theme'); } catch { return null; }
    })();
    let pref = ['system', 'dark', 'light'].includes(stored) ? stored : 'system';

    function apply() {
      const resolved = pref === 'system' ? (media.matches ? 'light' : 'dark') : pref;
      document.documentElement.dataset.theme = resolved;
      const iconName = pref === 'system' ? 'auto' : pref === 'dark' ? 'moon' : 'sun';
      const label = I18N[currentLang].theme[pref];
      use?.setAttribute('href', `#i-${iconName}`);
      button?.setAttribute('title', `${currentLang === 'ar' ? 'المظهر' : 'Appearance'}: ${label}`);
      button?.setAttribute('aria-label', `${currentLang === 'ar' ? 'المظهر الحالي' : 'Current appearance'}: ${label}`);
      $('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#1d1d1f' : '#f6f5f4');
    }

    button?.addEventListener('click', () => {
      pref = { system: 'dark', dark: 'light', light: 'system' }[pref];
      try { localStorage.setItem('wasel-theme', pref); } catch { /* تجاهل */ }
      apply();
      showToast(`${currentLang === 'ar' ? 'المظهر' : 'Appearance'}: ${I18N[currentLang].theme[pref]}`);
    });

    media.addEventListener?.('change', () => { if (pref === 'system') apply(); });
    window.addEventListener('wasel:langchange', apply);
    apply();
  }

  /* ----------------------------------------------------------- التنقّل */

  function initNavigation() {
    const toggle = $('#nav-toggle');
    const nav = $('#primary-nav');
    const close = () => {
      nav?.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    };

    toggle?.addEventListener('click', () => {
      const open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });

    nav?.addEventListener('click', (event) => { if (event.target.closest('a')) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    document.addEventListener('click', (event) => {
      if (nav?.classList.contains('is-open') && !event.target.closest('#primary-nav, #nav-toggle')) close();
    });

    const links = $$('.nav__link');
    const sections = links.map((link) => $(link.getAttribute('href'))).filter(Boolean);
    if ('IntersectionObserver' in window && sections.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            if (link.getAttribute('href') === `#${entry.target.id}`) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-30% 0px -62% 0px', threshold: 0 });
      sections.forEach((section) => observer.observe(section));
    }
  }

  function initScrollEffects() {
    const progress = $('#scroll-progress');
    const toTop = $('#to-top');
    let ticking = false;

    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (progress) progress.style.width = `${ratio * 100}%`;
      toTop?.classList.toggle('is-visible', window.scrollY > 600);
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    toTop?.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    const items = $$('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
    } else {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      items.forEach((item) => observer.observe(item));
    }
  }

  /* -------------------------------------------------------------- نسخ */

  let toastTimer;
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch { return false; }
  }

  function initCopy() {
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      const value = button.dataset.copy || '';
      const ok = await copyText(value);
      if (!ok) { showToast(t('copyFail')); return; }
      showToast(`${t('copied')}${value.length > 34 ? `${value.slice(0, 34)}…` : value}`);
      const original = button.innerHTML;
      button.innerHTML = `${icon('check')} ${currentLang === 'ar' ? 'تم' : 'Done'}`;
      button.style.color = 'var(--success)';
      setTimeout(() => { button.innerHTML = original; button.style.color = ''; }, 1600);
    });
  }

  /* ------------------------------------------------------------ GitHub */

  async function fetchJson(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(API + path, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!response.ok) throw new Error(`GitHub ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.repo && Array.isArray(parsed.releases) ? parsed : null;
    } catch { return null; }
  }

  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* تجاهل */ }
  }

  function selectStable(releases) {
    const stable = (releases || [])
      .filter((release) => release && !release.draft && !release.prerelease)
      .sort((a, b) => compareVersions(a.tag_name, b.tag_name)
        || Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
    return stable[0] || null;
  }

  function bestAsset(release) {
    const assets = (release?.assets || []).filter(safeAssetUrl);
    return assets.find((asset) => /\.apk$/i.test(asset.name || ''))
      || assets.find((asset) => /apk/i.test(asset.name || ''))
      || assets[0]
      || null;
  }

  function digestHex(asset) {
    const match = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    return match ? match[1] : '';
  }

  function setSync(key, state = 'ok') {
    lastSync = { key, state };
    const note = $('#sync-note');
    if (!note) return;
    const dot = $('.pulse-dot', note);
    if (dot) dot.style.background = state === 'warn' ? 'var(--warning)' : '';
    note.lastChild.nodeValue = ` ${t(key)}`;
  }

  function assetRow(asset) {
    const hash = digestHex(asset);
    const shortHash = hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '';
    const url = safeUrl(asset.browser_download_url);
    const count = nf.format(Number(asset.download_count) || 0);
    return `
      <div class="asset-row">
        <span class="asset-row__icon">${icon(/\.apk$/i.test(asset.name || '') ? 'android' : 'download')}</span>
        <span class="asset-row__name">
          <b>${esc(asset.name || 'file')}</b>
          <small>${esc(formatBytes(asset.size))} · ${count} ${esc(t('downloads'))}${hash ? ` · SHA256: ${esc(shortHash)}` : ''}</small>
        </span>
        ${hash ? `<button type="button" class="copy-btn" data-copy="${esc(hash)}" title="${esc(hash)}">${icon('copy')} SHA256</button>` : ''}
        <button type="button" class="copy-btn copy-btn--icon" data-copy="${esc(url)}" aria-label="${esc(t('copyLink'))}" title="${esc(t('copyLink'))}">${icon('copy')}</button>
        <a class="icon-btn icon-btn--link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(currentLang === 'ar' ? 'تنزيل' : 'Download')} ${esc(asset.name || 'file')}">${icon('download')}</a>
      </div>`;
  }

  function renderLatest(release) {
    const container = $('#latest-release');
    if (!container) return;
    const notes = String(release?.body || '').trim() || t('noNotes');
    const date = formatDate(release?.published_at);
    const version = esc(release?.tag_name || '—');
    const assets = (release?.assets || []).filter(safeAssetUrl);

    container.innerHTML = `
      <div class="release-card__head">
        <div>
          <span class="pill pill--success">${icon('check')} ${esc(t('latestStable'))}</span>
          <h3>${version} <small>— ${esc(date)}</small></h3>
          <span class="release-card__age" id="release-age">${esc(relativeTime(release?.published_at))}</span>
        </div>
        <a class="btn btn--primary" href="${esc(safeUrl(release?.html_url))}" target="_blank" rel="noopener noreferrer">${icon('download')} ${esc(t('releasePage'))}</a>
      </div>
      <p class="release-card__notes">${esc(notes)}</p>
      <div class="asset-list">${assets.length ? assets.map(assetRow).join('') : `<p class="notice">${esc(t('noAssets'))}</p>`}</div>`;

    const apk = bestAsset(release);
    const cta = $('#download-cta');
    if (cta) cta.href = safeUrl(apk ? apk.browser_download_url : release?.html_url);
    const versionLabel = String(release?.tag_name || '').trim();
    setTranslated($('#download-label'),
      `${I18N.ar.downloadApk}${versionLabel ? ` — ${versionLabel}` : ''}`,
      `${I18N.en.downloadApk}${versionLabel ? ` — ${versionLabel}` : ''}`);
    const pillText = `${t('latestStable')}: ${release?.tag_name || '—'}`;
    setTranslated($('#version-pill span'), pillText, `${I18N.en.latestStable}: ${release?.tag_name || '—'}`);
    const releaseDate = $('#release-date');
    if (releaseDate) releaseDate.textContent = date;
  }

  function renderOlder(releases, latest, query = '') {
    const details = $('#older-releases');
    const list = $('#older-list');
    if (!details || !list) return;

    const normalized = query.trim().toLowerCase();
    const items = (releases || [])
      .filter((release) => release && release !== latest)
      .filter((release) => {
        if (!normalized) return true;
        const haystack = [release.tag_name, release.name, release.body,
          ...(release.assets || []).map((asset) => asset.name)].join(' ').toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0)
        || compareVersions(a.tag_name, b.tag_name));

    $('#older-count').textContent = nf.format(items.length);
    details.hidden = items.length === 0 && !normalized;
    list.innerHTML = items.length ? items.map((release) => {
      const assets = (release?.assets || []).filter(safeAssetUrl);
      const note = String(release?.body || '').trim().split('\n')[0].slice(0, 160);
      return `
        <article class="mini-release">
          <div class="mini-release__head">
            <b>${esc(release.tag_name || '—')}</b>
            ${release.prerelease ? `<span class="badge-prerelease">${esc(t('preRelease'))}</span>` : ''}
            <span>${esc(formatDate(release.published_at))}${note ? ` · ${esc(note)}` : ''}</span>
          </div>
          ${assets.length ? `<div class="mini-release__assets">${assets.map((asset) => `
            <a href="${esc(safeUrl(asset.browser_download_url))}" target="_blank" rel="noopener noreferrer">${icon('download')} ${esc(asset.name || 'file')} · ${esc(formatBytes(asset.size))}</a>`).join('')}</div>` : ''}
        </article>`;
    }).join('') : `<p class="notice">${esc(t('noSearch'))}</p>`;
  }

  let statsDone = false;
  function animateStats(targets) {
    [['#stat-stars', targets.stars], ['#stat-downloads', targets.downloads], ['#stat-releases', targets.releases]].forEach(([selector, value]) => {
      const node = $(selector);
      if (!node) return;
      const target = Number(value) || 0;
      node.dataset.value = String(target);
      if (statsDone || reduceMotion) { node.textContent = nf.format(target); return; }
      const duration = 950;
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = nf.format(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    statsDone = true;
  }

  function applyData(data) {
    currentData = data;
    currentReleases = Array.isArray(data.releases) ? data.releases : [];
    currentLatest = selectStable(currentReleases) || FALLBACK.releases[0];
    const repo = data.repo || FALLBACK.repo;

    renderLatest(currentLatest);
    renderOlder(currentReleases, currentLatest, releaseQuery);

    const stars = Number(repo.stargazers_count) || 0;
    const starCount = $('#star-count');
    if (starCount) starCount.textContent = nf.format(stars);
    const starLink = $('#star-link');
    if (starLink) {
      starLink.href = safeUrl(repo.html_url || `https://github.com/${REPO}`);
      starLink.setAttribute('aria-label', t('starsOnGithub')(nf.format(stars)));
    }

    const downloads = currentReleases.reduce((total, release) => total
      + (release?.assets || []).reduce((sum, asset) => sum + (Number(asset.download_count) || 0), 0), 0);

    const statsSection = $('.stats');
    const values = { stars, downloads, releases: Math.max(currentReleases.length, 1) };
    if (statsSection && 'IntersectionObserver' in window && !statsDone) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          animateStats(values);
          observer.disconnect();
        }
      }, { threshold: 0.2 });
      observer.observe(statsSection);
    } else {
      animateStats(values);
    }
  }

  const FALLBACK = {
    repo: { stargazers_count: 0, forks_count: 0, subscribers_count: 0, html_url: `https://github.com/${REPO}` },
    releases: [{
      tag_name: 'v1.0.0',
      name: 'v1.0.0',
      draft: false,
      prerelease: false,
      published_at: '2026-11-25T20:30:05Z',
      body: '1st version',
      html_url: 'https://github.com/mouadkennedy2001/Wasel-calls/releases/tag/v1.0.0',
      assets: [{
        name: 'Wasel-calls.apk',
        size: 3978630,
        download_count: 0,
        digest: 'sha256:fc392ede78d9aa56db855eb758e6e01fc918ddb09b6f6b0c273b49fc8d08fb53',
        browser_download_url: 'https://github.com/mouadkennedy2001/Wasel-calls/releases/download/v1.0.0/Wasel-calls.apk'
      }]
    }]
  };

  async function loadGithubData() {
    const cached = readCache();
    if (cached) {
      applyData(cached);
      setSync(cached.live === false ? 'syncStale' : 'syncCached');
    }

    try {
      const [repo, releases] = await Promise.all([
        fetchJson(`/repos/${REPO}`),
        fetchJson(`/repos/${REPO}/releases?per_page=100`)
      ]);
      if (!Array.isArray(releases)) throw new Error('Unexpected payload');
      const data = { repo, releases, fetchedAt: Date.now(), live: true };
      writeCache(data);
      applyData(data);
      setSync('syncLive');
    } catch (error) {
      if (cached) setSync('syncStale', 'warn');
      else {
        applyData({ repo: FALLBACK.repo, releases: FALLBACK.releases, live: false });
        setSync('syncFallback', 'warn');
      }
      console.warn('Wasel site: GitHub data unavailable:', error?.message || error);
    }
  }

  /* -------------------------------------------------------------- بدء */

  initI18n();
  setSync('syncLoading');
  initTheme();
  initNavigation();
  initScrollEffects();
  initCopy();

  $('#release-filter')?.addEventListener('input', (event) => {
    releaseQuery = event.target.value || '';
    if (currentReleases.length) renderOlder(currentReleases, currentLatest, releaseQuery);
  });

  loadGithubData();
})();
