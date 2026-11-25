const PATHS = {
  chat: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9h8M8 12h5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 6a3 3 0 010 6M17 14c2.4.7 4 2.8 4 5"/>',
  phone: '<path d="M6 3h3l2 5-2 2a13 13 0 006 6l2-2 5 2v3c0 1.1-.9 2-2 2A17 17 0 014 5c0-1.1.9-2 2-2z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  'phone-off': '<path d="M3 3l18 18M6 3h3l2 5-2 2a13 13 0 004 4M21 17v3a2 2 0 01-2 2A17 17 0 014 5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v4M9 22h6"/>',
  'mic-off': '<path d="M3 3l18 18M9 6a3 3 0 015.8-1M15 11v0a3 3 0 01-4.6 2.5M5 11a7 7 0 0011.7 5.2M19 11a7 7 0 01-.6 2.8M12 18v4M9 22h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<path d="M5 5h14v14H5z"/>',
  send: '<path d="M3 12l18-8-6 18-3-7-9-3z"/>',
  file: '<path d="M6 2h8l5 5v15H6V2z"/><path d="M14 2v6h5"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 17V5M7 9l5-5 5 5M4 20h16"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/>',
  wifi: '<path d="M2 8a16 16 0 0120 0M5 12a11 11 0 0114 0M8 16a6 6 0 018 0"/><circle cx="12" cy="20" r="1"/>',
  network: '<rect x="3" y="14" width="5" height="6" rx="1"/><rect x="10" y="9" width="5" height="11" rx="1"/><rect x="17" y="4" width="5" height="16" rx="1"/>',
  room: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  'check-double': '<path d="M2 13l4 4 8-9M10 17l2 2 10-12"/>',
  'chevron-left': '<path d="M15 5l-7 7 7 7"/>',
  'chevron-right': '<path d="M9 5l7 7-7 7"/>',
  'chevron-down': '<path d="M5 9l7 7 7-7"/>',
  logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  palette: '<path d="M12 3a9 9 0 000 18h2a2 2 0 001.4-3.4A2 2 0 0116 15h2a3 3 0 003-3c0-5-4-9-9-9z"/><circle cx="7" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="8" r="1"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 010 6M18 6a8 8 0 010 12"/>',
  'volume-off': '<path d="M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="13" width="4" height="7" rx="1"/><rect x="17" y="13" width="4" height="7" rx="1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4zM14 6l4 4"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
  'arrow-left': '<path d="M20 12H4M10 6l-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>',
  bell: '<path d="M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7zM10 20h4"/>',
  'bell-off': '<path d="M3 3l18 18M6 9a6 6 0 0110-4M18 16H4s2-1 2-7M10 20h4"/>',
  moon: '<path d="M20 15a8 8 0 01-11-11 8 8 0 1011 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  folder: '<path d="M3 7h6l2 2h10v11H3V7z"/>',
  link: '<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-2 2M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l2-2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  'eye-off': '<path d="M3 3l18 18M10 6.3A10 10 0 0112 6c6.5 0 10 6 10 6a15 15 0 01-3 3.5M6.5 8C3.7 9.7 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  star: '<path d="M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 9-12h-6l1-8z"/>'
};

export function injectSprite() {
  const host = document.getElementById('icon-sprite');
  if (!host || host.dataset.ready === '1') return;
  host.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden">' +
    Object.entries(PATHS).map(([name, body]) =>
      `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`
    ).join('') + '</svg>';
  host.dataset.ready = '1';
}

export function icon(name, extra) {
  const key = Object.prototype.hasOwnProperty.call(PATHS, name) ? name : 'info';
  return `<svg class="icon ${extra || ''}" aria-hidden="true"><use href="#i-${key}"></use></svg>`;
}

export const iconNames = Object.keys(PATHS);
