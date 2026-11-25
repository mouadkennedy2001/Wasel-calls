'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../src/main/server');

function connect(port, id, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === msg.t) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    ws, inbox,
    open: () => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }),
    send: (obj) => ws.send(JSON.stringify(obj)),
    wait: (type, ms) => new Promise((resolve, reject) => {
      const found = inbox.find((m) => m.t === type);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error('timeout waiting for ' + type)), ms || 3000);
      waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    }),
    close: () => ws.close()
  };
}

test('end-to-end: hello, room, chat, file upload and download', { timeout: 15000 }, async (t) => {
  const app = createServer({ port: 0 });
  const { port } = await app.listen();
  t.after(async () => { await app.close(); });

  const alice = connect(port, 'alice-device-0001', 'Alice');
  const bob = connect(port, 'bob-device-00001', 'Bob');
  await Promise.all([alice.open(), bob.open()]);

  alice.send({ t: 'hello', id: 'alice-device-0001', name: 'Alice', username: 'alice', device: 'desktop' });
  const welcomeA = await alice.wait('welcome');
  assert.equal(welcomeA.you.name, 'Alice');
  assert.ok(welcomeA.token);

  bob.send({ t: 'hello', id: 'bob-device-00001', name: 'Bob', username: 'bob', device: 'mobile' });
  const welcomeB = await bob.wait('welcome');
  assert.ok(welcomeB.peers.some((p) => p.name === 'Alice'));
  await alice.wait('peer:join');

  alice.send({ t: 'room:create', name: 'غرفة الاختبار', description: 'LAN' });
  const created = await alice.wait('room:created');
  assert.ok(created.room.id);

  bob.send({ t: 'room:join', roomId: created.room.id });
  await bob.wait('room:joined');
  await alice.wait('peer:join-room');

  alice.send({ t: 'chat', roomId: created.room.id, text: 'مرحبا بوب' });
  const message = await bob.wait('chat');
  assert.equal(message.message.text, 'مرحبا بوب');
  assert.equal(message.message.from, 'alice-device-0001');

  const sharedName = 'تقرير wasel.txt';
  const fileResponse = await fetch(`http://127.0.0.1:${port}/api/upload`, {
    method: 'POST',
    headers: {
      'x-wasel-token': welcomeA.token,
      'x-wasel-name': encodeURIComponent('../' + sharedName),
      'x-wasel-size': '12',
      'x-wasel-room': created.room.id,
      'x-wasel-mime': 'text/plain'
    },
    body: Buffer.from('hello wasel!')
  });
  assert.equal(fileResponse.status, 200);
  const uploaded = await fileResponse.json();
  assert.equal(uploaded.name, sharedName);

  alice.send({ t: 'file:notify', fileId: uploaded.id, roomId: created.room.id });
  const shared = await bob.wait('file:shared');
  assert.equal(shared.file.name, sharedName);

  const download = await fetch(`http://127.0.0.1:${port}/api/download?id=${uploaded.id}&token=${uploaded.token}`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'hello wasel!');
  assert.match(download.headers.get('content-disposition') || '', /attachment/);

  alice.close();
  bob.close();
});
