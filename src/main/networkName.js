'use strict';
const os = require('node:os');
const { execFile } = require('node:child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2500, windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

function lanAddress() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal || /vpn|tap|loopback|virtual/i.test(name)) continue;
      let score = 0;
      if (/wi-fi|wireless|ethernet|إيثرنت/i.test(name)) score += 100;
      if (item.address.startsWith('192.168.')) score += 30;
      else if (item.address.startsWith('10.')) score += 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(item.address)) score += 20;
      if (item.address.startsWith('169.254.')) score -= 50;
      found.push({ address: item.address, score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.address || '127.0.0.1';
}

async function windowsInfo() {
  const raw = await run('netsh', ['wlan', 'show', 'interfaces']);
  const ssid = (raw.match(/SSID\s*:\s*(.+)/i) || [])[1];
  const state = (raw.match(/State\s*:\s*(.+)/i) || [])[1];
  if (ssid && ssid.trim() && /connected/i.test(state || 'connected')) {
    return { name: ssid.trim().replace(/[\r\n]/g, '').slice(0, 64), type: 'wifi' };
  }
  const ifaces = await run('netsh', ['interface', 'show', 'interface']);
  const lines = ifaces.split(/\r?\n/).filter((line) => /\bConnected\b/i.test(line));
  const names = lines.map((line) => line.replace(/^\s*Enabled\s+/, '').replace(/^\s*Connected\s+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const wifi = lines.find((line) => /wi-fi|wireless/i.test(line));
  return { name: (names[0] || 'Ethernet').slice(0, 64), type: wifi ? 'wifi' : 'ethernet' };
}

async function linuxInfo() {
  let ssid = await run('iwgetid', ['-r']);
  if (!ssid) {
    const nmcli = await run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']);
    ssid = (nmcli.split('\n').find((l) => l.startsWith('yes:')) || '').slice(4);
  }
  if (ssid.trim()) return { name: ssid.trim().slice(0, 64), type: 'wifi' };
  return { name: 'Ethernet', type: 'ethernet' };
}

async function macInfo() {
  const ssid = await run('networksetup', ['-getairportnetwork', 'en0']);
  const m = ssid.match(/Current Wi-Fi Network:\s*(.+)/i);
  if (m && !/not associated/i.test(m[1])) return { name: m[1].trim().slice(0, 64), type: 'wifi' };
  return { name: 'Ethernet', type: 'ethernet' };
}

async function getNetworkInfo() {
  let info = { name: 'LAN', type: 'unknown' };
  try {
    if (process.platform === 'win32') info = await windowsInfo();
    else if (process.platform === 'linux') info = await linuxInfo();
    else if (process.platform === 'darwin') info = await macInfo();
  } catch (_) { /* keep fallback */ }
  if (!info.name || !info.name.trim()) info = { name: 'LAN', type: 'unknown' };
  return { name: info.name.trim().slice(0, 64), type: info.type, ip: lanAddress(), hostname: os.hostname().slice(0, 64) };
}

module.exports = { getNetworkInfo, lanAddress };
