'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { callback(payload); } catch (_) { /* renderer callback error must not crash main */ }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('wasel', Object.freeze({
  platform: 'electron',
  app: Object.freeze({
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    message: (message, type) => ipcRenderer.invoke('dialog:message', { message, type })
  }),
  window: Object.freeze({
    minimize: () => ipcRenderer.invoke('window:control', 'minimize'),
    maximize: () => ipcRenderer.invoke('window:control', 'maximize'),
    close: () => ipcRenderer.invoke('window:control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window:maximized')
  }),
  store: Object.freeze({
    get: (key, fallback) => ipcRenderer.invoke('store:get', key, fallback),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value)
  }),
  auth: Object.freeze({
    accounts: () => ipcRenderer.invoke('auth:accounts'),
    signup: (username, password, profile) => ipcRenderer.invoke('auth:signup', username, password, profile),
    login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
    updateProfile: (username, profile) => ipcRenderer.invoke('auth:profile', username, profile),
    changePassword: (username, oldPassword, newPassword) => ipcRenderer.invoke('auth:password', username, oldPassword, newPassword),
    remove: (username, password) => ipcRenderer.invoke('auth:delete', username, password)
  }),
  net: Object.freeze({
    info: () => ipcRenderer.invoke('net:info'),
    onDiscovery: (callback) => subscribe('discovery:update', callback)
  }),
  voice: Object.freeze({
    supported: true,
    udpStart: (host, room) => ipcRenderer.invoke('voice:udp-start', host, room),
    udpSend: (bytes) => ipcRenderer.invoke('voice:udp-send', Array.from(bytes)),
    udpStop: () => ipcRenderer.invoke('voice:udp-stop'),
    onUdpFrame: (callback) => subscribe('voice:udp-frame', (arr) => callback(new Uint8Array(arr)))
  }),
  theme: Object.freeze({
    onSystem: (callback) => subscribe('theme:system', callback)
  })
}));
