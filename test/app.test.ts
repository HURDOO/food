import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/server/app.ts';
import type { Assets } from '../src/server/assets.ts';
import { createAuth } from '../src/server/auth.ts';
import type { Config } from '../src/server/config.ts';
import { FileStore } from '../src/server/store.ts';
import { fakeJpeg, includesAscii } from './helpers.ts';

const PASSWORD = 'correct horse battery';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 300.0';

const assets: Assets = {
  href: (name) => `/assets/${name}`,
  file: (name) => (name === 'admin.css' ? { body: Buffer.from('a{}'), type: 'text/css; charset=utf-8' } : null),
};

function setup(overrides: Partial<Config> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'food-app-'));
  const config: Config = {
    production: true,
    port: 3000,
    host: '127.0.0.1',
    baseUrl: 'https://food.example.test',
    storageDir: dir,
    assetsDir: '',
    adminPassword: PASSWORD,
    secureCookies: true,
    devPageDirs: [],
    kitDir: '',
    ...overrides,
  };
  const store = new FileStore(dir);
  const app = createApp({ config, store, auth: createAuth(PASSWORD, store.sessionKey()), assets });
  return { dir, store, app };
}

const INDEX = '<!doctype html><title>민수 &amp; 밥약</title><meta property="og:image" content="%PAGE_URL%photo.jpg"><p>방문자 %VIEWS%</p><script src="kit.js"></script>';

function bundle(files: Record<string, string | Uint8Array<ArrayBuffer>>) {
  const fd = new FormData();
  for (const [name, data] of Object.entries(files)) fd.append('files', new Blob([data]), name);
  return fd;
}

const bearer = (password = PASSWORD) => ({ authorization: `Bearer ${password}` });

describe('food app', () => {
  let ctx: ReturnType<typeof setup>;
  let cookie = '';
  let id = '';

  before(() => {
    ctx = setup();
  });
  after(() => rmSync(ctx.dir, { recursive: true, force: true }));

  test('health check reports writable storage', async () => {
    const res = await ctx.app.request('/healthz');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  test('home and unknown pages render without leaking anything', async () => {
    const home = await ctx.app.request('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    const missing = await ctx.app.request('/h/AAAAAAAAAA/');
    assert.equal(missing.status, 404);
  });

  test('uploading needs the admin password', async () => {
    const files = bundle({ 'index.html': INDEX });
    assert.equal((await ctx.app.request('/api/pages', { method: 'POST', body: files })).status, 401);
    assert.equal((await ctx.app.request('/api/pages', { method: 'POST', body: files, headers: bearer('wrong') })).status, 401);
  });

  test('a bundle without index.html or with bad names is refused with reasons', async () => {
    const res = await ctx.app.request('/api/pages', { method: 'POST', headers: bearer(), body: bundle({ 'style.css': 'p{}', 'Bad Name.css': 'x' }) });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { problems: string[] };
    assert.ok(body.problems.some((p) => p.includes('index.html')));
    assert.ok(body.problems.some((p) => p.includes('Bad Name.css')));
    const broken = await ctx.app.request('/api/pages', { method: 'POST', headers: bearer(), body: bundle({ 'index.html': INDEX, 'photo.jpg': new TextEncoder().encode('nope') }) });
    assert.equal(broken.status, 400);
  });

  test('a page is uploaded, photos lose their EXIF, and the link works', async () => {
    const res = await ctx.app.request('/api/pages', {
      method: 'POST',
      headers: bearer(),
      body: bundle({ 'index.html': INDEX, 'style.css': 'p{color:red}', 'photo.jpg': fakeJpeg(), 'kit.js': 'void 0' }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; url: string };
    id = body.id;
    assert.match(id, /^[A-Za-z0-9]{10}$/);
    assert.equal(body.url, `https://food.example.test/h/${id}/`);

    const photo = await ctx.app.request(`/h/${id}/photo.jpg`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    const bytes = new Uint8Array(await photo.arrayBuffer());
    assert.ok(!includesAscii(bytes, 'GPS'));
    assert.ok(includesAscii(bytes, 'JFIF'));
  });

  test('the public home lists uploaded pages with their cover photo', async () => {
    const res = await ctx.app.request('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`href="/h/${id}/"`));
    assert.ok(html.includes('민수 &amp; 밥약'));
    assert.ok(html.includes(`src="/h/${id}/photo.jpg"`));
  });

  test('the bare link redirects to the folder so relative files resolve', async () => {
    const res = await ctx.app.request(`/h/${id}`);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), `/h/${id}/`);
    const index = await ctx.app.request(`/h/${id}/index.html`);
    assert.equal(index.status, 308);
  });

  test('the page fills placeholders, counts real visitors, and locks scripts to its own files', async () => {
    const res = await ctx.app.request(`/h/${id}/`, { headers: { 'user-agent': BROWSER } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`content="https://food.example.test/h/${id}/photo.jpg"`));
    assert.ok(html.includes('방문자 1'));
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);

    await ctx.app.request(`/h/${id}/`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
    await ctx.app.request(`/h/${id}/`, { headers: { 'user-agent': 'kakaotalk-scrap/1.0' } });
    assert.equal(ctx.store.get(id)?.views, 1, 'link preview bots are not counted');
  });

  test('page files are served with their type and revalidate cheaply', async () => {
    const css = await ctx.app.request(`/h/${id}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    const etag = css.headers.get('etag') ?? '';
    assert.ok(etag);
    const again = await ctx.app.request(`/h/${id}/style.css`, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304);
    for (const path of [`/h/${id}/meta.json`, `/h/${id}/..%2Fmeta.json`, `/h/${id}/missing.css`, `/h/${id}/Style.css`]) {
      assert.equal((await ctx.app.request(path)).status, 404, path);
    }
  });

  test('reactions are recorded from visitors but not from bots, and bad input is refused', async () => {
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      ctx.app.request(`/h/${id}/react`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': BROWSER, ...headers }, body: JSON.stringify(body) });
    assert.equal((await send({ key: 'again', value: '콜' })).status, 204);
    assert.equal((await send({ key: 'no', value: '3번 도망' })).status, 204);
    assert.equal((await send({ key: 'again', value: '봇' }, { 'user-agent': 'Googlebot' })).status, 204);
    assert.equal((await send({ key: 'Not OK' })).status, 400);
    assert.equal((await send({ key: 'again' }, { origin: 'https://evil.example' })).status, 403);
    const big = await ctx.app.request(`/h/${id}/react`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'a', value: 'x'.repeat(2000) }) });
    assert.equal(big.status, 413);
    assert.equal((await ctx.app.request('/h/AAAAAAAAAA/react', { method: 'POST', body: '{}' })).status, 404);
    const reactions = ctx.store.get(id)?.reactions ?? {};
    assert.equal(reactions.again?.value, '콜');
    assert.equal(reactions.again?.count, 1);
    assert.equal(reactions.no?.value, '3번 도망');
  });

  test('shared counts add up across visitors, skip bots and refuse bad input', async () => {
    const add = (body: unknown, headers: Record<string, string> = {}) =>
      ctx.app.request(`/h/${id}/count`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': BROWSER, ...headers }, body: JSON.stringify(body) });
    assert.deepEqual(await (await add({ key: 'like', add: 3 })).json(), { total: 3 });
    assert.deepEqual(await (await add({ key: 'like', add: 5 })).json(), { total: 8 });
    assert.deepEqual(await (await add({ key: 'like', add: 9 }, { 'user-agent': 'Googlebot' })).json(), { total: 8 });
    for (const bad of [{ key: 'like', add: 0 }, { key: 'like', add: 1.5 }, { key: 'like', add: 501 }, { key: 'Bad Key', add: 1 }, { key: 'like', add: '2' }]) {
      assert.equal((await add(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await add({ key: 'like', add: 1 }, { origin: 'https://evil.example' })).status, 403);
    const read = await ctx.app.request(`/h/${id}/counts`);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), { counts: { like: 8 } });
    assert.equal((await ctx.app.request('/h/AAAAAAAAAA/counts')).status, 404);
  });

  test('re-uploading keeps the same link, views and reactions', async () => {
    const res = await ctx.app.request(`/api/pages/${id}`, { method: 'PUT', headers: bearer(), body: bundle({ 'index.html': '<title>고친 판</title><p>v2 %VIEWS%</p>' }) });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { id: string }).id, id);
    const html = await (await ctx.app.request(`/h/${id}/`, { headers: { 'user-agent': BROWSER } })).text();
    assert.ok(html.includes('v2 2'));
    assert.equal((await ctx.app.request(`/h/${id}/photo.jpg`)).status, 404, 'files from the old upload are gone');
    assert.equal(ctx.store.get(id)?.reactions.again?.value, '콜');
    assert.equal((await ctx.app.request('/api/pages/AAAAAAAAAA', { method: 'PUT', headers: bearer(), body: bundle({ 'index.html': INDEX }) })).status, 404);
  });

  test('admin pages need a login', async () => {
    const res = await ctx.app.request('/admin');
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/admin/login');
    assert.equal((await ctx.app.request(`/admin/api/pages/${id}/delete`, { method: 'POST' })).status, 401);
    const wrong = await ctx.app.request('/admin/login', { method: 'POST', body: new URLSearchParams({ password: 'nope' }) });
    assert.equal(wrong.status, 401);
  });

  test('login sets a secure session cookie and the list shows pages with reactions', async () => {
    const res = await ctx.app.request('/admin/login', { method: 'POST', body: new URLSearchParams({ password: PASSWORD }) });
    assert.equal(res.status, 303);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    cookie = setCookie.split(';')[0] ?? '';

    const list = await ctx.app.request('/admin', { headers: { cookie } });
    assert.equal(list.status, 200);
    const html = await list.text();
    assert.ok(html.includes('고친 판'));
    assert.ok(html.includes(`https://food.example.test/h/${id}/`));
    assert.ok(html.includes('조회 2'));
    assert.ok(html.includes('3번 도망'));
  });

  test('my own visits and taps are not counted', async () => {
    const before = ctx.store.get(id);
    await ctx.app.request(`/h/${id}/`, { headers: { cookie, 'user-agent': BROWSER } });
    await ctx.app.request(`/h/${id}/react`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'mine', value: 'x' }) });
    const after = ctx.store.get(id);
    assert.equal(after?.views, before?.views);
    assert.equal(after?.reactions.mine, undefined);
  });

  test('admin output escapes titles and reaction values', async () => {
    const res = await ctx.app.request('/api/pages', { method: 'POST', headers: bearer(), body: bundle({ 'index.html': '<title>&lt;img src=x onerror=alert(1)&gt;</title>' }) });
    const evil = ((await res.json()) as { id: string }).id;
    ctx.store.recordReaction(evil, 'xss', '<script>alert(1)</script>');
    const html = await (await ctx.app.request('/admin', { headers: { cookie } })).text();
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&lt;img src=x'));
    ctx.store.delete(evil);
  });

  test('deleting takes the page down', async () => {
    const res = await ctx.app.request(`/admin/api/pages/${id}/delete`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal((await ctx.app.request(`/h/${id}/`)).status, 404);
    assert.equal((await ctx.app.request(`/h/${id}/style.css`)).status, 404);
  });

  test('dev preview routes do not exist in production', async () => {
    assert.equal((await ctx.app.request('/dev/')).status, 404);
    assert.equal((await ctx.app.request('/dev/sample/')).status, 404);
  });
});

test('dev preview serves local page folders with the current kit', async () => {
  const pages = mkdtempSync(join(tmpdir(), 'food-pages-'));
  const kit = mkdtempSync(join(tmpdir(), 'food-kit-'));
  mkdirSync(join(pages, 'minsu'));
  writeFileSync(join(pages, 'minsu', 'index.html'), '<title>민수</title><p>%VIEWS%</p>');
  writeFileSync(join(pages, 'minsu', 'style.css'), 'p{}');
  writeFileSync(join(kit, 'kit.js'), 'window.kit={}');
  const ctx = setup({ production: false, devPageDirs: [pages], kitDir: kit, baseUrl: 'http://192.168.0.2:3000' });
  try {
    const index = await ctx.app.request('/dev/');
    assert.ok((await index.text()).includes('/dev/minsu/'));
    const page = await ctx.app.request('/dev/minsu/');
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('<p>0</p>'));
    assert.equal((await ctx.app.request('/dev/minsu/kit.js')).status, 200);
    assert.equal((await ctx.app.request('/dev/minsu/style.css')).status, 200);
    assert.equal((await ctx.app.request('/dev/minsu/nope.css')).status, 404);
    assert.equal((await ctx.app.request('/dev/..%2Fminsu/')).status, 404);
    assert.equal((await ctx.app.request('/dev/minsu')).status, 303);
  } finally {
    for (const d of [ctx.dir, pages, kit]) rmSync(d, { recursive: true, force: true });
  }
});

test('repeated wrong upload passwords are throttled', async () => {
  const ctx = setup();
  try {
    for (let i = 0; i < 10; i++) await ctx.app.request('/api/pages', { method: 'POST', headers: bearer('wrong') });
    const res = await ctx.app.request('/api/pages', { method: 'POST', headers: bearer(), body: bundle({ 'index.html': INDEX }) });
    assert.equal(res.status, 429);
  } finally {
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});
