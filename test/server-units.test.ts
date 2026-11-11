import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAuth, createLoginLimiter } from '../src/server/auth.ts';
import { checkBundle, fillPlaceholders, MAX_FILES, readTitle, type BundleFile } from '../src/server/bundle.ts';
import { loadConfig } from '../src/server/config.ts';
import { cleanMedia, MediaError, stripJpegMetadata, stripPngMetadata } from '../src/server/media.ts';
import { FileStore, MAX_REACTION_KEYS } from '../src/server/store.ts';
import { fakeJpeg, fakePng, includesAscii } from './helpers.ts';

const file = (name: string, text = 'x'): BundleFile => ({ name, data: Buffer.from(text) });
const page = (title = '테스트') => [file('index.html', `<title>${title}</title><p>hi</p>`), file('style.css', 'p{}')];

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
  assert.throws(() => stripJpegMetadata(new TextEncoder().encode('<svg></svg>')), MediaError);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40])), MediaError);
  assert.throws(() => stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), MediaError);
});

test('stripPngMetadata drops text and EXIF chunks and keeps the image', () => {
  const out = stripPngMetadata(fakePng());
  assert.ok(!includesAscii(out, 'secret note'));
  assert.ok(!includesAscii(out, 'GPS'));
  assert.ok(includesAscii(out, 'IHDR'));
  assert.ok(includesAscii(out, 'IDAT'));
  assert.ok(includesAscii(out, 'IEND'));
  assert.throws(() => stripPngMetadata(fakePng().subarray(0, 30)), MediaError);
  assert.throws(() => stripPngMetadata(fakeJpeg()), MediaError);
});

test('cleanMedia picks the cleaner by extension and passes other files through', () => {
  assert.ok(!includesAscii(cleanMedia('a.JPG', fakeJpeg()), 'GPS'));
  assert.ok(!includesAscii(cleanMedia('a.png', fakePng()), 'GPS'));
  assert.equal(cleanMedia('a.css', Buffer.from('p{}')).toString(), 'p{}');
  assert.throws(() => cleanMedia('fake.jpg', Buffer.from('not a photo')), MediaError);
});

test('checkBundle accepts a flat page and explains what is wrong otherwise', () => {
  assert.deepEqual(checkBundle(page()), []);
  assert.match(checkBundle([file('style.css')]).join(), /index\.html/);
  for (const bad of ['../x.html', 'sub/a.css', 'Photo.JPG', 'a.exe', '.env', 'a.heic', 'index.html.bak']) {
    assert.notDeepEqual(checkBundle([...page(), file(bad)]), [], bad);
  }
  assert.match(checkBundle([...page(), file('style.css')]).join(), /두 번/);
  const many = Array.from({ length: MAX_FILES }, (_, i) => file(`f${i}.txt`));
  assert.match(checkBundle([...page(), ...many]).join(), /개까지/);
});

test('readTitle and fillPlaceholders', () => {
  assert.equal(readTitle('<title>\n 민수 &amp; 나 </title>'), '민수 & 나');
  assert.equal(readTitle('<p>no title</p>'), '제목 없음');
  assert.equal(fillPlaceholders('<a href="%PAGE_URL%x.jpg">%VIEWS% %VIEWS%</a>', { pageUrl: 'https://f/h/a/', views: 7 }), '<a href="https://f/h/a/x.jpg">7 7</a>');
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

test('config refuses to start without an admin password and never serves dev pages in production', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'short' }), /at least 8/);
  assert.throws(() => loadConfig({ ALLOW_DEV_PASSWORD: '1', NODE_ENV: 'production' }), /ADMIN_PASSWORD/);
  assert.equal(loadConfig({ ALLOW_DEV_PASSWORD: '1' }).adminPassword, 'dev');
  const config = loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'long enough', APP_BASE_URL: 'https://food.app.example/', DEV_PAGE_DIRS: 'pages' });
  assert.equal(config.baseUrl, 'https://food.app.example');
  assert.equal(config.secureCookies, true);
  assert.deepEqual(config.devPageDirs, []);
  assert.equal(loadConfig({ ALLOW_DEV_PASSWORD: '1', DEV_PAGE_DIRS: 'pages,examples' }).devPageDirs.length, 2);
});

test('file store creates, replaces, counts and deletes pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-store-'));
  try {
    const store = new FileStore(dir);
    const created = store.create('첫 판', page('첫 판'));
    assert.match(created.id, /^[A-Za-z0-9]{10}$/);
    assert.equal(store.readFile(created.id, 'style.css')?.data.toString(), 'p{}');
    assert.equal(store.readFile(created.id, '../meta.json'), null);
    assert.equal(store.readFile('../../etc', 'index.html'), null);

    store.recordView(created.id);
    store.recordReaction(created.id, 'again', '  콜  ');
    store.recordReaction(created.id, 'again', '콜');
    assert.equal(store.recordReaction(created.id, 'Bad Key', 'x'), null);

    const replaced = store.replace(created.id, '둘째 판', [file('index.html', '<title>둘째 판</title>'), file('new.txt', 'n')]);
    assert.ok(replaced);
    assert.equal(replaced.title, '둘째 판');
    assert.equal(replaced.views, 1, 'views survive a re-upload');
    assert.deepEqual({ value: replaced.reactions.again?.value, count: replaced.reactions.again?.count }, { value: '콜', count: 2 });
    assert.equal(store.readFile(created.id, 'style.css'), null, 'old files are gone');
    assert.equal(store.readFile(created.id, 'new.txt')?.data.toString(), 'n');
    const bundles = readdirSync(join(dir, 'pages', created.id)).filter((n) => n.startsWith('b-'));
    assert.equal(bundles.length, 1, 'only the current bundle stays on disk');

    assert.equal(store.list().length, 1);
    assert.ok(store.delete(created.id));
    assert.ok(!existsSync(join(dir, 'pages', created.id)));
    assert.equal(store.replace(created.id, 'x', page()), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file store keeps a bounded number of reaction keys and trims values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-store-'));
  try {
    const store = new FileStore(dir);
    const { id } = store.create('t', page());
    for (let i = 0; i < MAX_REACTION_KEYS + 5; i++) store.recordReaction(id, `k${i}`, 'v');
    store.recordReaction(id, 'k0', 'x'.repeat(500));
    const meta = store.get(id);
    assert.equal(Object.keys(meta?.reactions ?? {}).length, MAX_REACTION_KEYS);
    assert.equal(meta?.reactions.k0?.value.length, 80);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session key is created once and reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-store-'));
  try {
    const first = new FileStore(dir).sessionKey();
    const second = new FileStore(dir).sessionKey();
    assert.equal(first.length, 32);
    assert.ok(first.equals(second));
    assert.ok(readFileSync(join(dir, 'session.key')).equals(first));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the sample page is a valid bundle once the kit files are added', () => {
  const dir = join(import.meta.dirname, '..', 'examples', 'sample');
  const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  const withKit = [...files, file('kit.js'), file('kit.css')];
  assert.deepEqual(checkBundle(withKit), []);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('src="kit.js"'));
  assert.ok(!/<script>(?!<\/script>)/.test(html), 'no inline scripts (CSP blocks them)');
  assert.ok(!/\son[a-z]+=/i.test(html), 'no inline event handlers (CSP blocks them)');
});
