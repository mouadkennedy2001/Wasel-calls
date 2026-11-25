'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/shared/validate');
const C = require('../src/shared/constants');
const { packet, parse } = require('../src/main/udpVoice');

test('cleanText removes control characters and trims', () => {
  assert.equal(V.cleanText('  مرحبا\u0000\u200b  ', 50), 'مرحبا');
  assert.throws(() => V.cleanText('x'.repeat(5000), C.MAX_TEXT), RangeError);
});

test('filename strips paths and rejects traversal', () => {
  assert.equal(V.filename('C:\\Users\\test\\report.pdf'), 'report.pdf');
  assert.equal(V.filename('../../etc/passwd'), 'passwd');
  assert.throws(() => V.filename('..'));
  assert.throws(() => V.filename(''));
});

test('decodeHeaderValue handles encoded non-Latin filenames', () => {
  const name = 'تقرير completo 100%.pdf';
  assert.equal(V.decodeHeaderValue(encodeURIComponent(name)), name);
  assert.equal(V.decodeHeaderValue('100% report.txt'), '100% report.txt');
  assert.equal(V.filename(V.decodeHeaderValue(encodeURIComponent('../' + name))), name);
});

test('avatar only allows small image data URLs', () => {
  assert.equal(V.avatar('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.throws(() => V.avatar('javascript:alert(1)'));
  assert.throws(() => V.avatar('data:image/png;base64,' + 'A'.repeat(C.MAX_AVATAR_BYTES)));
});

test('json rejects huge or malformed frames', () => {
  assert.deepEqual(V.json('{"t":"ping"}', 1024), { t: 'ping' });
  assert.throws(() => V.json('[]', 1024));
  assert.throws(() => V.json('x'.repeat(2000), 1024), RangeError);
});

test('signalData validates SDP and ICE payloads', () => {
  assert.equal(V.signalData({ type: 'sdp', sdp: { type: 'offer', sdp: 'v=0...' } }).type, 'sdp');
  assert.equal(V.signalData({ type: 'ice', candidate: { candidate: 'candidate:1' } }).type, 'ice');
  assert.equal(V.signalData({ type: 'call', kind: 'video', callId: 'c-12345678' }).type, 'call');
  assert.equal(V.signalData({ type: 'call-answer', callId: 'c-12345678' }).type, 'call-answer');
  assert.equal(V.signalData({ type: 'call-end', callId: 'c-12345678' }).type, 'call-end');
  assert.throws(() => V.signalData({ type: 'sdp', sdp: { type: 'x', sdp: '' } }));
});

test('UDP voice packet round trip', () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const buf = packet(1, 'device-123', 'room-abc', 7, pcm);
  const parsed = parse(buf);
  assert.equal(parsed.type, 1);
  assert.equal(parsed.id, 'device-123');
  assert.equal(parsed.room, 'room-abc');
  assert.equal(parsed.seq, 7);
  assert.deepEqual(Buffer.from(parsed.payload), pcm);
  assert.equal(parse(Buffer.from('garbage')), null);
});
