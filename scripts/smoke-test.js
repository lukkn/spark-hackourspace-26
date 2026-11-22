// End-to-end API check against a throwaway database:  npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3999;
const DB = path.join(os.tmpdir(), `spark-test-${Date.now()}.db`);
const KEY = 'test-key';
const base = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DB_FILE: DB, DEVICE_KEY: KEY, DEMO_MODE: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('Dashboard')) resolve(); });
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

const post = (p, body, key = KEY) => fetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Device-Key': key } : {}) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const state = () => fetch(`${base}/api/state`).then((r) => r.json());

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

try {
  await test('writes without the device key are rejected', async () => {
    const r = await post('/api/device/tap', { pet: 'cs', uid: '04:A1:CS:00:00:01' }, null);
    assert.equal(r.status, 401);
    const r2 = await post('/api/device/tap', { pet: 'cs', uid: '04:A1:CS:00:00:01' }, 'wrong-key!');
    assert.equal(r2.status, 401);
  });

  await test('unknown cards are reported with their uid', async () => {
    const r = await post('/api/device/tap', { pet: 'cs', uid: 'de:ad:be:ef' });
    assert.equal(r.status, 404);
    assert.equal(r.uid, 'DEADBEEF');
  });

  await test('students cannot interact with the other major\'s pet', async () => {
    const r = await post('/api/device/tap', { pet: 'cs', uid: '04:B2:DS:00:00:01' });
    assert.equal(r.status, 403);
    assert.equal(r.error, 'wrong_major');
    assert.equal((await state()).pets.cs.points, 0);
  });

  let session;
  await test('first tap of the day awards check-in points', async () => {
    const r = await post('/api/device/tap', { pet: 'cs', uid: '04a1cs000001' }); // uid format-insensitive
    assert.equal(r.status, 200);
    assert.equal(r.checkin.points, 10);
    session = r.session;
    const s = await state();
    assert.equal(s.pets.cs.points, 10);
    assert.equal(s.pets.cs.actions.checkin.today, 1);
  });

  await test('second tap the same day does not re-award check-in', async () => {
    const r = await post('/api/device/tap', { pet: 'cs', uid: '04:A1:CS:00:00:01' });
    assert.equal(r.checkin, null);
    assert.equal((await state()).pets.cs.points, 10);
    session = r.session;
  });

  await test('actions award points and update counts', async () => {
    const r = await post('/api/device/action', { session, action: 'assignment' });
    assert.equal(r.ok, true);
    const s = await state();
    assert.equal(s.pets.cs.points, 35);
    assert.equal(s.pets.cs.actions.assignment.today, 1);
    assert.equal(s.pets.cs.actions.assignment.total, 1);
    assert.equal(s.pets.ds.points, 0);
  });

  await test('cooldowns block spamming the same action', async () => {
    const r = await post('/api/device/action', { session, action: 'assignment' });
    assert.equal(r.status, 429);
    assert.ok(r.secondsLeft > 0);
  });

  await test('shipping a product triggers a celebration', async () => {
    const r = await post('/api/device/action', { session, action: 'shipped' });
    assert.equal(r.celebrate, true);
    assert.equal((await state()).pets.cs.points, 135);
  });

  await test('check-in cannot be logged as a button action', async () => {
    const r = await post('/api/device/action', { session, action: 'checkin' });
    assert.equal(r.status, 400);
  });

  await test('bogus sessions are rejected', async () => {
    const r = await post('/api/device/action', { session: 'nope', action: 'pet' });
    assert.equal(r.status, 401);
  });

  await test('DS kiosk works for DS students', async () => {
    const r = await post('/api/device/tap', { pet: 'ds', uid: '04:B2:DS:00:00:02' });
    assert.equal(r.status, 200);
    const s = await state();
    assert.equal(s.pets.ds.points, 10);
    assert.equal(s.pets.ds.visitorsToday, 1);
    assert.equal(s.recent[0].who, 'John');
  });

  console.log(`\n  ${passed} passed\n`);
} catch (err) {
  console.error('\n  ✗ FAILED:', err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  setTimeout(() => { try { fs.rmSync(DB, { force: true }); } catch {} }, 300);
}
