import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

const assets: Assets = {
  href: (name) => `/assets/${name}`,
  inlineTributeScript: () => ({ code: 'void 0', hash: 'dGVzdA==' }),
  file: (name) => (name === 'admin.css' ? { body: Buffer.from('a{}'), type: 'text/css; charset=utf-8' } : null),
};

function setup() {
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
  };
  const store = new FileStore(dir);
  const app = createApp({ config, store, auth: createAuth(PASSWORD, store.sessionKey()), assets });
  return { dir, store, app };
}

function tributeForm(overrides: Record<string, string> = {}, photo: Uint8Array<ArrayBuffer> | null = null) {
  const fd = new FormData();
  const fields = { senior: '김호랑', junior: '이새내', major: '경영학과', year: '22', menu: '마라탕', place: '참살이길', date: '2026-11-10', price: '38000', note: '감사합니다', level: '2', ...overrides };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (photo) fd.set('photo', new File([photo], 'photo.jpg', { type: 'image/jpeg' }));
  return fd;
}

describe('food app', () => {
  let ctx: ReturnType<typeof setup>;
  let cookie = '';
  let id = '';
  const admin = (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), cookie } });

  before(() => {
    ctx = setup();
  });
  after(() => rmSync(ctx.dir, { recursive: true, force: true }));

  test('health check reports writable storage', async () => {
    const res = await ctx.app.request('/healthz');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  test('admin pages and API require login', async () => {
    const page = await ctx.app.request('/admin');
    assert.equal(page.status, 303);
    assert.equal(page.headers.get('location'), '/admin/login');
    const nested = await ctx.app.request('/admin/new');
    assert.equal(nested.status, 303);
    const api = await ctx.app.request('/admin/api/tributes', { method: 'POST', body: tributeForm() });
    assert.equal(api.status, 401);
  });

  test('wrong password is rejected', async () => {
    const res = await ctx.app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=nope',
    });
    assert.equal(res.status, 401);
    assert.match(await res.text(), /비밀번호가 맞지 않아요/);
  });

  test('correct password sets a secure, http-only session cookie', async () => {
    const res = await ctx.app.request('/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    assert.equal(res.status, 303);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /bt_admin=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Lax/);
    cookie = setCookie.split(';')[0] as string;
    const list = await ctx.app.request('/admin', admin());
    assert.equal(list.status, 200);
    assert.match(await list.text(), /아직 만든 헌정관이 없어요/);
  });

  test('creating a tribute validates fields', async () => {
    const res = await ctx.app.request('/admin/api/tributes', admin({ method: 'POST', body: tributeForm({ senior: '', year: '2022' }) }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.ok(body.errors.senior);
    assert.ok(body.errors.year);
  });

  test('creating a tribute rejects non-JPEG photos', async () => {
    const res = await ctx.app.request('/admin/api/tributes', admin({ method: 'POST', body: tributeForm({}, new TextEncoder().encode('<svg/>')) }));
    assert.equal(res.status, 400);
    assert.ok(((await res.json()) as { errors: Record<string, string> }).errors.photo);
  });

  test('creating a tribute stores the photo without location metadata', async () => {
    const res = await ctx.app.request('/admin/api/tributes', admin({ method: 'POST', body: tributeForm({}, fakeJpeg()) }));
    assert.equal(res.status, 201);
    id = ((await res.json()) as { id: string }).id;
    const stored = ctx.store.get(id);
    assert.ok(stored?.photo);
    const photo = await ctx.app.request(`/p/${stored.photo}`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    const bytes = new Uint8Array(await photo.arrayBuffer());
    assert.ok(!includesAscii(bytes, 'GPS'));
  });

  test('tribute page renders all scenes with an inline script allowed by CSP', async () => {
    const res = await ctx.app.request(`/h/${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Instagram 300.0' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>김호랑 선배님 헌정관<\/title>/);
    assert.equal(html.match(/<section class="screen/g)?.length, 6);
    assert.match(html, /property="og:image" content="https:\/\/food\.example\.test\/p\//);
    assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self' 'sha256-dGVzdA=='/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(ctx.store.get(id)?.stats.views, 1);
  });

  test('views from the owner and link-preview bots are not counted', async () => {
    await ctx.app.request(`/h/${id}`, admin());
    await ctx.app.request(`/h/${id}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } });
    await ctx.app.request(`/h/${id}`, { headers: { 'user-agent': 'kakaotalk-scrap/1.0' } });
    assert.equal(ctx.store.get(id)?.stats.views, 1);
  });

  test('senior reactions are recorded', async () => {
    const yes = await ctx.app.request(`/h/${id}/yes`, { method: 'POST' });
    assert.equal(yes.status, 204);
    const bad = await ctx.app.request(`/h/${id}/coupon`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choice: '현금' }) });
    assert.equal(bad.status, 400);
    const good = await ctx.app.request(`/h/${id}/coupon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: '케이크 한 조각' }),
    });
    assert.equal(good.status, 204);
    const t = ctx.store.get(id);
    assert.ok(t?.stats.agreedAt);
    assert.equal(t?.stats.coupon, '케이크 한 조각');
    const share = await ctx.app.request(`/admin/t/${id}`, admin());
    assert.match(await share.text(), /케이크 한 조각/);
  });

  test('cross-site POSTs are refused', async () => {
    const res = await ctx.app.request(`/admin/api/tributes/${id}/delete`, admin({ method: 'POST', headers: { cookie, origin: 'https://evil.example' } }));
    assert.equal(res.status, 403);
    assert.ok(ctx.store.get(id));
  });

  test('editing keeps reactions and can remove the photo', async () => {
    const fd = tributeForm({ menu: '순대국밥', level: '3' });
    fd.set('removePhoto', '1');
    const res = await ctx.app.request(`/admin/api/tributes/${id}`, admin({ method: 'POST', body: fd }));
    assert.equal(res.status, 200);
    const t = ctx.store.get(id);
    assert.equal(t?.menu, '순대국밥');
    assert.equal(t?.photo, null);
    assert.equal(t?.stats.coupon, '케이크 한 조각');
  });

  test('user input is escaped on public and admin pages', async () => {
    const res = await ctx.app.request('/admin/api/tributes', admin({ method: 'POST', body: tributeForm({ senior: '<b>x</b>', note: '"><img src=x>' }) }));
    const evilId = ((await res.json()) as { id: string }).id;
    const page = await (await ctx.app.request(`/h/${evilId}`)).text();
    assert.ok(!page.includes('<b>x</b>'));
    assert.ok(!page.includes('<img src=x>'));
    const list = await (await ctx.app.request('/admin', admin())).text();
    assert.ok(!list.includes('<b>x</b>'));
  });

  test('deleting removes the tribute', async () => {
    const res = await ctx.app.request(`/admin/api/tributes/${id}/delete`, admin({ method: 'POST' }));
    assert.equal(res.status, 200);
    const gone = await ctx.app.request(`/h/${id}`);
    assert.equal(gone.status, 404);
    assert.match(await gone.text(), /헌정관을 찾을 수 없어요/);
  });

  test('repeated wrong passwords are throttled', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await ctx.app.request('/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'password=guess',
      });
      last = res.status;
    }
    assert.equal(last, 429);
  });
});
