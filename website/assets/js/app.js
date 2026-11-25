/* واصل كولز — منطق الموقع الثابت
   - جلب أحدث إصدار مستقر وإحصائيات المستودع من GitHub API
   - بيانات احتياطية + تخزين مؤقت للعمل دون اتصال
   - مظهر GNOME (داكن/فاتح/تلقائي)، تنقّل، عدّادات، نسخ البصمة */
(() => {
  'use strict';

  const REPO = 'mouadkennedy2001/Wasel-calls';
  const API = 'https://api.github.com';
  const RELEASES_URL = `https://github.com/${REPO}/releases`;
  const CACHE_KEY = 'wasel:github-cache';
  const CACHE_TTL = 10 * 60 * 1000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  const nf = new Intl.NumberFormat('ar-u-nu-latn');
  const df = new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

  // بيانات احتياطية من وقت النشر، تظهر فقط إن تعذّر الوصول إلى GitHub.
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

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const safeUrl = (url) => (/^https:\/\/github\.com\//i.test(String(url || '')) ? String(url) : RELEASES_URL);

  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : df.format(date);
  };

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

  function setSync(message, state = 'ok') {
    const note = $('#sync-note');
    if (!note) return;
    const dot = $('.pulse-dot', note);
    if (dot) dot.style.background = state === 'warn' ? 'var(--warning)' : '';
    note.lastChild.nodeValue = ` ${message}`;
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
      document.documentElement.dataset.themePref = pref;
      const iconName = pref === 'system' ? 'auto' : pref === 'dark' ? 'moon' : 'sun';
      const label = { system: 'تلقائي', dark: 'داكن', light: 'فاتح' }[pref];
      use?.setAttribute('href', `#i-${iconName}`);
      button?.setAttribute('title', `المظهر: ${label} (اضغط للتبديل)`);
      button?.setAttribute('aria-label', `المظهر الحالي: ${label}`);
      $('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#1d1d1f' : '#f6f5f4');
    }

    button?.addEventListener('click', () => {
      pref = { system: 'dark', dark: 'light', light: 'system' }[pref];
      try { localStorage.setItem('wasel-theme', pref); } catch { /* تخزين غير متاح */ }
      apply();
      showToast(`المظهر: ${{ system: 'تلقائي', dark: 'داكن', light: 'فاتح' }[pref]}`);
    });

    media.addEventListener?.('change', () => { if (pref === 'system') apply(); });
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
    let ticking = false;

    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (progress) progress.style.width = `${ratio * 100}%`;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

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
      if (!ok) { showToast('تعذّر النسخ، انسخ النص يدوياً'); return; }
      showToast(`تم النسخ: ${value.length > 34 ? `${value.slice(0, 34)}…` : value}`);
      const original = button.innerHTML;
      button.innerHTML = `${icon('check')} تم`;
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
    const assets = (release?.assets || []).filter((asset) => safeAssetUrl(asset));
    return assets.find((asset) => /\.apk$/i.test(asset.name || ''))
      || assets.find((asset) => /apk/i.test(asset.name || ''))
      || assets[0]
      || null;
  }

  function safeAssetUrl(asset) {
    return /^https:\/\/github\.com\//i.test(String(asset?.browser_download_url || ''));
  }

  function digestHex(asset) {
    const match = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    return match ? match[1] : '';
  }

  function assetRow(asset) {
    const hash = digestHex(asset);
    const shortHash = hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '';
    const url = safeUrl(asset.browser_download_url);
    const count = nf.format(Number(asset.download_count) || 0);
    return `
      <div class="asset-row">
        <span class="asset-row__icon">${icon(/$apk$/i.test(asset.name || '') ? 'android' : 'download')}</span>
        <span class="asset-row__name">
          <b>${esc(asset.name || 'ملف')}</b>
          <small>${esc(formatBytes(asset.size))} · ${count} تحميل${hash ? ` · SHA256: ${esc(shortHash)}` : ''}</small>
        </span>
        ${hash ? `<button type="button" class="copy-btn" data-copy="${esc(hash)}" title="${esc(hash)}">${icon('copy')} SHA256</button>` : ''}
        <a class="icon-btn icon-btn--link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="تنزيل ${esc(asset.name || 'الملف')}">${icon('download')}</a>
      </div>`;
  }

  function renderLatest(release) {
    const container = $('#latest-release');
    if (!container) return;
    const notes = String(release?.body || '').trim() || 'لا توجد ملاحظات مُرفقة بهذا الإصدار.';
    const date = formatDate(release?.published_at);
    const version = esc(release?.tag_name || '—');
    const assets = (release?.assets || []).filter(safeAssetUrl);

    container.innerHTML = `
      <div class="release-card__head">
        <div>
          <span class="pill pill--success">${icon('check')} أحدث مستقر</span>
          <h3>${version} <small>— ${esc(date)}</small></h3>
        </div>
        <a class="btn btn--primary" href="${esc(safeUrl(release?.html_url))}" target="_blank" rel="noopener noreferrer">${icon('download')} صفحة التحميل</a>
      </div>
      <p class="release-card__notes">${esc(notes)}</p>
      <div class="asset-list">${assets.length ? assets.map(assetRow).join('') : `<p class="notice">لا توجد ملفات قابلة للتحميل في هذا الإصدار؛ افتح صفحة الإصدار على GitHub.</p>`}</div>`;

    const apk = bestAsset(release);
    const cta = $('#download-cta');
    if (cta && apk) cta.href = safeUrl(apk.browser_download_url);
    else if (cta) cta.href = safeUrl(release?.html_url);
    const label = $('#download-label');
    if (label) label.textContent = `تنزيل ${apk ? 'APK' : 'الإصدار'} — ${release?.tag_name || 'الأحدث'}`;
    const pill = $('#version-pill');
    if (pill) pill.innerHTML = `${icon('check')} أحدث مستقر: ${version}`;
    const releaseDate = $('#release-date');
    if (releaseDate) releaseDate.textContent = date;
  }

  function renderOlder(releases, latest) {
    const details = $('#older-releases');
    const list = $('#older-list');
    if (!details || !list) return;

    const items = (releases || [])
      .filter((release) => release && release !== latest)
      .sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0)
        || compareVersions(a.tag_name, b.tag_name));

    $('#older-count').textContent = nf.format(items.length);
    details.hidden = items.length === 0;
    list.innerHTML = items.map((release) => {
      const assets = (release?.assets || []).filter(safeAssetUrl);
      const note = String(release?.body || '').trim().split('\n')[0].slice(0, 160);
      return `
        <article class="mini-release">
          <div class="mini-release__head">
            <b>${esc(release.tag_name || 'بدون اسم')}</b>
            ${release.prerelease ? '<span class="badge-prerelease">تجريبي</span>' : ''}
            <span>${esc(formatDate(release.published_at))}${note ? ` · ${esc(note)}` : ''}</span>
          </div>
          ${assets.length ? `<div class="mini-release__assets">${assets.map((asset) => `
            <a href="${esc(safeUrl(asset.browser_download_url))}" target="_blank" rel="noopener noreferrer">${icon('download')} ${esc(asset.name || 'ملف')} · ${esc(formatBytes(asset.size))}</a>`).join('')}</div>` : ''}
        </article>`;
    }).join('');
  }

  let statsDone = false;
  function animateStats(targets) {
    const nodes = [['#stat-stars', targets.stars], ['#stat-downloads', targets.downloads], ['#stat-releases', targets.releases]];
    nodes.forEach(([selector, value]) => {
      const node = $(selector);
      if (!node) return;
      const target = Number(value) || 0;
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
    const releases = Array.isArray(data.releases) ? data.releases : [];
    const repo = data.repo || FALLBACK.repo;
    const latest = selectStable(releases) || FALLBACK.releases[0];

    renderLatest(latest);
    renderOlder(releases, latest);

    const stars = Number(repo.stargazers_count) || 0;
    const starCount = $('#star-count');
    if (starCount) starCount.textContent = nf.format(stars);
    const starLink = $('#star-link');
    if (starLink) {
      starLink.href = safeUrl(repo.html_url || `https://github.com/${REPO}`);
      starLink.setAttribute('aria-label', `${nf.format(stars)} نجمة على GitHub — افتح المستودع`);
    }

    const downloads = releases.reduce((total, release) => total
      + (release?.assets || []).reduce((sum, asset) => sum + (Number(asset.download_count) || 0), 0), 0);

    const statsSection = $('.stats');
    if (statsSection && 'IntersectionObserver' in window && !statsDone) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          animateStats({ stars, downloads, releases: Math.max(selectStable(releases) ? releases.length : 1, 1) });
          observer.disconnect();
        }
      }, { threshold: 0.2 });
      observer.observe(statsSection);
    } else {
      animateStats({ stars, downloads, releases: Math.max(releases.length, 1) });
    }

    if (repo.description && $('meta[name="description"]')) {
      // الوصف الثابت في HTML مكتوب بعناية، لا يُستبدل تلقائياً.
    }
  }

  async function loadGithubData() {
    const cached = readCache();
    if (cached) {
      applyData(cached);
      setSync(cached.live === false ? 'بيانات مخزّنة مؤقتاً' : 'آخر تحديث من GitHub محفوظ محلياً');
    }

    try {
      const [repo, releases] = await Promise.all([
        fetchJson(`/repos/${REPO}`),
        fetchJson(`/repos/${REPO}/releases?per_page=100`)
      ]);
      if (!Array.isArray(releases)) throw new Error('صيغة غير متوقعة');
      const data = { repo, releases, fetchedAt: Date.now(), live: true };
      writeCache(data);
      applyData(data);
      setSync('تم التحديث تلقائياً من GitHub الآن');
    } catch (error) {
      if (cached) {
        setSync('تعذّر الاتصال بـ GitHub — عرض بيانات مخزّنة', 'warn');
      } else {
        applyData({ repo: FALLBACK.repo, releases: FALLBACK.releases, live: false });
        setSync('عرض بيانات احتياطية — GitHub غير متاح حالياً', 'warn');
      }
      console.warn('Wasel site: GitHub data unavailable:', error?.message || error);
    }
  }

  /* -------------------------------------------------------------- بدء */

  initTheme();
  initNavigation();
  initScrollEffects();
  initCopy();
  loadGithubData();
})();
