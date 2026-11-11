import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAuth, createLoginLimiter } from '../src/server/auth.ts';
import { loadConfig } from '../src/server/config.ts';
import { JpegError, stripJpegMetadata } from '../src/server/jpeg.ts';
import { FileStore } from '../src/server/store.ts';
import type { TributeInput } from '../src/shared/tribute.ts';
import { fakeJpeg, includesAscii } from './helpers.ts';

const input: TributeInput = {
  senior: '김호랑',
  junior: '이새내',
  major: '',
  year: '',
  menu: '국밥',
  place: '',
  date: '2026-11-10',
  price: null,
  showPrice: false,
  note: '',
  level: 1,
};

test('stripJpegMetadata removes EXIF and comments but keeps image data and color profile', () => {
  const out = stripJpegMetadata(fakeJpeg());
  assert.ok(!includesAscii(out, 'Exif'));
  assert.ok(!includesAscii(out, 'GPS'));
  assert.ok(!includesAscii(out, 'comment'));
  assert.ok(includesAscii(out, 'ICC_PROFILE'));
  assert.ok(includesAscii(out, 'JFIF'));
  assert.deepEqual([...out.subarray(-6)], [0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
});

test('stripJpegMetadata rejects files that are not JPEG', () => {
  assert.throws(() => stripJpegMetadata(new TextEncoder().encode('<svg></svg>')), JpegError);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40])), JpegError);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), JpegError);
});

test('sessions verify only untampered, unexpired tokens', () => {
  const key = Buffer.alloc(32, 7);
  const auth = createAuth('correct horse', key);
  const now = 1_800_000_000_000;
  const token = auth.issue(now);
  assert.ok(auth.verify(token, now + 1000));
  assert.ok(!auth.verify(token, now + 31 * 24 * 60 * 60 * 1000));
  assert.ok(!auth.verify(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, now));
  assert.ok(!auth.verify(undefined, now));
  assert.ok(!createAuth('other password', key).verify(token, now));
  assert.ok(auth.checkPassword('correct horse'));
  assert.ok(!auth.checkPassword('correct hors'));
});

test('login limiter blocks after repeated failures and recovers after the window', () => {
  const limiter = createLoginLimiter(3, 1000);
  limiter.fail(0);
  limiter.fail(10);
  assert.ok(!limiter.blocked(20));
  limiter.fail(30);
  assert.ok(limiter.blocked(40));
  assert.ok(!limiter.blocked(1500));
});

test('config refuses to start without an admin password unless dev mode allows it', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'short' }), /at least 8/);
  assert.throws(() => loadConfig({ ALLOW_DEV_PASSWORD: '1', NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.equal(loadConfig({ ALLOW_DEV_PASSWORD: '1' }).adminPassword, 'dev');
  const config = loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'long enough', APP_BASE_URL: 'https://food.app.example/' });
  assert.equal(config.baseUrl, 'https://food.app.example');
  assert.equal(config.secureCookies, true);
});

test('file store creates, updates, records reactions and deletes with photos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-store-'));
  try {
    const store = new FileStore(dir);
    const photo = stripJpegMetadata(fakeJpeg());
    const created = store.create(input, photo);
    assert.match(created.id, /^[A-Za-z0-9]{10}$/);
    assert.ok(created.photo && store.readPhoto(created.photo));

    store.recordView(created.id);
    store.recordView(created.id);
    store.recordYes(created.id);
    store.recordCoupon(created.id, '아아 한 잔');
    const reacted = store.get(created.id);
    assert.equal(reacted?.stats.views, 2);
    assert.ok(reacted?.stats.agreedAt);
    assert.equal(reacted?.stats.coupon, '아아 한 잔');

    const replaced = store.update(created.id, { ...input, menu: '순대국밥' }, { kind: 'replace', data: photo });
    assert.equal(replaced?.menu, '순대국밥');
    assert.notEqual(replaced?.photo, created.photo);
    assert.equal(store.readPhoto(created.photo as string), null, 'old photo is removed');
    assert.equal(replaced?.stats.views, 2, 'stats survive edits');

    const removed = store.update(created.id, input, { kind: 'remove' });
    assert.equal(removed?.photo, null);
    assert.deepEqual(readdirSync(join(dir, 'photos')), []);

    assert.equal(store.list().length, 1);
    assert.ok(store.delete(created.id));
    assert.equal(store.get(created.id), null);
    assert.equal(store.get('../session'), null);
    assert.equal(store.readPhoto('../tributes/x.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session key is created once and reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-key-'));
  try {
    const first = new FileStore(dir).sessionKey();
    const second = new FileStore(dir).sessionKey();
    assert.equal(first.length, 32);
    assert.deepEqual(first, second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
