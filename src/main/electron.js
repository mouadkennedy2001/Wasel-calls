'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme, dialog } = require('electron');
const C = require('../shared/constants');
const { createServer } = require('./server');
const { Discovery } = require('./discovery');
const { UdpVoiceClient } = require('./udpVoice');
const storage = require('./storage');
const { getNetworkInfo } = require('./networkName');

let mainWindow = null;
let tray = null;
let appServer = null;
let discovery = null;
let udpClient = null;
let actualPort = C.DEFAULT_HTTP_PORT;
const deviceId = crypto.randomBytes(10).toString('hex');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });

  app.whenReady().then(boot).catch((err) => {
    console.error('مكالمات واصل boot error:', err);
    app.quit();
  });
}

async function startLocalServer() {
  const preferred = Number(process.env.WASEL_PORT) || C.DEFAULT_HTTP_PORT;
  for (let port = preferred; port < preferred + 12; port++) {
    const candidate = createServer({ port });
    try {
      const info = await candidate.listen();
      return { app: candidate, ...info };
    } catch (err) {
      try { await candidate.close(); } catch (_) { /* ignore */ }
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    }
  }
  throw new Error('لا توجد منفذ متاح لتشغيل التطبيق');
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 780,
    minHeight: 560,
    title: `${C.APP_NAME} — ${C.VERSION}`,
    backgroundColor: '#1b1b1b',
    show: false,
    icon: iconPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${actualPort}/`);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${actualPort}/`)) event.preventDefault();
  });
  // Read the setting at close time so toggling it does not need a restart.
  win.on('close', (event) => {
    if (!app.isQuitting && storage.getSetting('minimizeToTray', true)) {
      event.preventDefault();
      win.hide();
    }
  });
  return win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
}

async function boot() {
  storage.init(app.getPath('userData'));

  const started = await startLocalServer();
  appServer = started.app;
  actualPort = started.port;

  mainWindow = createMainWindow();

  const updateTheme = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theme:system', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
  };
  nativeTheme.on('updated', updateTheme);

  const self = {
    id: deviceId,
    name: require('node:os').hostname().slice(0, 48),
    hostId: appServer.state.serverId,
    port: actualPort,
    udpPort: C.UDP_VOICE_PORT,
    network: started.network.name,
    isHost: true
  };
  discovery = new Discovery(self, (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('discovery:update', data);
  });
  discovery.start();

  createTray();
  registerIpc();
  buildMenu();

}

function iconPath(name) {
  const p = path.join(app.getAppPath(), 'build', 'icons', name);
  return fs.existsSync(p) ? p : undefined;
}

function createTray() {
  try {
    const image = iconPath('icon.png');
    tray = new Tray(image ? nativeImage.createFromPath(image).resize({ width: 16, height: 16 }) : nativeImage.createEmpty());
    tray.setToolTip(C.APP_NAME + ' — LAN');
    const menu = Menu.buildFromTemplate([
      { label: 'إظهار مكالمات واصل', click: () => showWindow() },
      { type: 'separator' },
      { label: 'خروج', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => showWindow());
  } catch (_) { tray = null; }
}

function buildMenu() {
  const template = [
    { label: 'مكالمات واصل', submenu: [
      { label: 'إظهار/إخفاء', click: () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); } },
      { type: 'separator' },
      { role: 'quit', label: 'خروج' }
    ] },
    { label: 'تحرير', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'عرض', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: C.VERSION,
    platform: 'electron',
    port: actualPort,
    deviceId,
    network: appServer ? appServer.state.network : null,
    isHost: true
  }));

  ipcMain.handle('window:control', (_e, action) => {
    if (!mainWindow) return false;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
    return true;
  });
  ipcMain.handle('window:maximized', () => !!(mainWindow && mainWindow.isMaximized()));

  ipcMain.handle('store:get', (_e, key, fallback) => storage.getSetting(key, fallback));
  ipcMain.handle('store:set', (_e, key, value) => storage.setSetting(key, value));
  ipcMain.handle('auth:accounts', () => storage.getAccounts());
  ipcMain.handle('auth:signup', (_e, username, password, profile) => storage.signup(username, password, profile));
  ipcMain.handle('auth:login', (_e, username, password) => storage.login(username, password));
  ipcMain.handle('auth:profile', (_e, username, profile) => storage.updateProfile(username, profile));
  ipcMain.handle('auth:password', (_e, username, oldPw, newPw) => storage.changePassword(username, oldPw, newPw));
  ipcMain.handle('auth:delete', (_e, username, password) => storage.deleteAccount(username, password));

  ipcMain.handle('net:info', async () => getNetworkInfo());

  ipcMain.handle('voice:udp-start', (_e, host, room) => {
    if (udpClient) udpClient.stop();
    udpClient = new UdpVoiceClient(host, C.UDP_VOICE_PORT, deviceId, room, (buf) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('voice:udp-frame', Array.from(buf));
    });
    return udpClient.start();
  });
  ipcMain.handle('voice:udp-send', (_e, bytes) => !!(udpClient && udpClient.send(Buffer.from(bytes))));
  ipcMain.handle('voice:udp-stop', () => { if (udpClient) { udpClient.stop(); udpClient = null; } return true; });

  ipcMain.handle('shell:openExternal', async (_e, url) => {
    try {
      const parsed = new URL(String(url));
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      await shell.openExternal(parsed.toString());
      return true;
    } catch (_) { return false; }
  });

  ipcMain.handle('dialog:message', (_e, options) => dialog.showMessageBox(mainWindow, {
    type: options && options.type === 'error' ? 'error' : 'info',
    buttons: ['حسناً'],
    message: String((options && options.message) || '').slice(0, 300)
  }).then(() => true));
}

app.on('activate', () => {
  if (!app.isReady()) return;
  if (appServer) showWindow();
  else boot();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (udpClient) udpClient.stop();
  if (discovery) discovery.stop();
  if (appServer) appServer.close();
});
