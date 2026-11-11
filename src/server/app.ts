import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isCouponOption, parseTributeInput, pickFood, toView, type FieldErrors, type Tribute } from '../shared/tribute.ts';
import type { Assets } from './assets.ts';
import { createLoginLimiter, SESSION_COOKIE, SESSION_DAYS, type Auth } from './auth.ts';
import type { Config } from './config.ts';
import { JpegError, stripJpegMetadata } from './jpeg.ts';
import * as pages from './pages.ts';
import type { FileStore, PhotoChange } from './store.ts';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

// 링크 미리보기를 만드는 봇은 조회수에 넣지 않는다.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|preview|headless|curl|wget/i;

function csp(scriptHash?: string): string {
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHash ? ` 'sha256-${scriptHash}'` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export interface AppDeps {
  config: Config;
  store: FileStore;
  auth: Auth;
  assets: Assets;
}

export function createApp({ config, store, auth, assets }: AppDeps) {
  const app = new Hono();
  const limiter = createLoginLimiter();
  const baseHost = new URL(config.baseUrl).host;

  const isAdmin = (c: Context) => auth.verify(getCookie(c, SESSION_COOKIE));
  const photoUrl = (t: Tribute) => (t.photo ? `/p/${t.photo}` : null);

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'DENY');
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', csp());
  });

  // 다른 사이트에서 보낸 POST는 막는다 (관리자 쿠키는 SameSite=Lax라 이중 안전장치).
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('origin');
      if (origin) {
        let host = '';
        try {
          host = new URL(origin).host;
        } catch {
          return c.text('forbidden', 403);
        }
        if (host !== baseHost && host !== c.req.header('host')) return c.text('forbidden', 403);
      }
    }
    await next();
  });

  app.get('/healthz', (c) => {
    try {
      store.assertWritable();
      return c.text('ok');
    } catch {
      return c.text('storage unavailable', 503);
    }
  });

  app.get('/', (c) => c.html(pages.homePage(assets.href('admin.css'))));

  app.get('/assets/:file', (c) => {
    const file = assets.file(c.req.param('file'));
    if (!file) return c.notFound();
    return c.body(new Uint8Array(file.body), 200, {
      'Content-Type': file.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  app.get('/p/:file', (c) => {
    const data = store.readPhoto(c.req.param('file'));
    if (!data) return c.notFound();
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  // ---------- 헌정관 (공개) ----------

  app.get('/h/:id', (c) => {
    const found = store.get(c.req.param('id'));
    if (!found) return c.notFound();
    const counted = !isAdmin(c) && !BOT_UA.test(c.req.header('user-agent') ?? '');
    const t = (counted && store.recordView(found.id)) || found;
    const view = toView(t, { photoUrl: photoUrl(t), views: t.stats.views, coupon: t.stats.coupon });
    const script = assets.inlineTributeScript();
    c.header('Content-Security-Policy', csp(script.hash));
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.html(pages.tributePage({ tribute: t, view, baseUrl: config.baseUrl, cssHref: assets.href('tribute.css'), script: script.code }));
  });

  const smallBody = bodyLimit({ maxSize: 1024, onError: (c) => c.text('too large', 413) });

  app.post('/h/:id/yes', smallBody, (c) => {
    const t = store.recordYes(c.req.param('id'));
    return t ? c.body(null, 204) : c.notFound();
  });

  app.post('/h/:id/coupon', smallBody, async (c) => {
    let choice: unknown;
    try {
      choice = ((await c.req.json()) as { choice?: unknown }).choice;
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    if (!isCouponOption(choice)) return c.json({ error: 'bad_choice' }, 400);
    const t = store.recordCoupon(c.req.param('id'), choice);
    return t ? c.body(null, 204) : c.notFound();
  });

  // ---------- 관리자 ----------

  app.get('/admin/login', (c) => (isAdmin(c) ? c.redirect('/admin', 303) : c.html(pages.loginPage(assets.href('admin.css'), null))));

  app.post('/admin/login', smallBody, async (c) => {
    if (limiter.blocked()) return c.html(pages.loginPage(assets.href('admin.css'), '시도가 너무 많아요. 15분 뒤에 다시 해 주세요.'), 429);
    const body = await c.req.parseBody();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !auth.checkPassword(password)) {
      limiter.fail();
      return c.html(pages.loginPage(assets.href('admin.css'), '비밀번호가 맞지 않아요.'), 401);
    }
    setCookie(c, SESSION_COOKIE, auth.issue(), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.redirect('/admin', 303);
  });

  app.post('/admin/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    return c.redirect('/admin/login', 303);
  });

  app.use('/admin/*', async (c, next) => {
    if (c.req.path === '/admin/login' || isAdmin(c)) return next();
    if (c.req.path.startsWith('/admin/api/')) return c.json({ error: 'unauthorized' }, 401);
    return c.redirect('/admin/login', 303);
  });
  app.use('/admin', async (c, next) => (isAdmin(c) ? next() : c.redirect('/admin/login', 303)));

  const noStore = (c: Context) => c.header('Cache-Control', 'no-store');

  app.get('/admin', (c) => {
    noStore(c);
    const items = store.list().map((tribute) => ({ tribute, food: pickFood(tribute.menu) }));
    return c.html(pages.adminListPage({ cssHref: assets.href('admin.css'), scriptHref: assets.href('admin.js'), baseUrl: config.baseUrl, items }));
  });

  app.get('/admin/new', (c) => {
    noStore(c);
    return c.html(pages.adminFormPage({ cssHrefs: [assets.href('tribute.css'), assets.href('admin.css')], scriptHref: assets.href('admin.js'), tribute: null }));
  });

  app.get('/admin/t/:id', (c) => {
    const t = store.get(c.req.param('id'));
    if (!t) return c.notFound();
    noStore(c);
    return c.html(
      pages.adminSharePage({
        cssHref: assets.href('admin.css'),
        scriptHref: assets.href('admin.js'),
        baseUrl: config.baseUrl,
        tribute: t,
        justCreated: c.req.query('new') === '1',
      }),
    );
  });

  app.get('/admin/t/:id/edit', (c) => {
    const t = store.get(c.req.param('id'));
    if (!t) return c.notFound();
    noStore(c);
    return c.html(pages.adminFormPage({ cssHrefs: [assets.href('tribute.css'), assets.href('admin.css')], scriptHref: assets.href('admin.js'), tribute: t }));
  });

  const uploadLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ errors: { photo: '사진이 너무 커요.' } }, 413) });

  async function readForm(c: Context): Promise<{ errors: FieldErrors; input: ReturnType<typeof parseTributeInput>['value']; photo: Buffer | null; removePhoto: boolean }> {
    const body = await c.req.parseBody();
    const { value, errors } = parseTributeInput(body as Record<string, unknown>);
    let photo: Buffer | null = null;
    const file = body.photo;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) errors.photo = '사진이 너무 커요. 다른 사진을 골라 주세요.';
      else {
        try {
          photo = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
        } catch (err) {
          if (!(err instanceof JpegError)) throw err;
          errors.photo = '사진을 읽지 못했어요. 다른 사진을 골라 주세요.';
        }
      }
    }
    return { errors, input: value, photo, removePhoto: body.removePhoto === '1' };
  }

  app.post('/admin/api/tributes', uploadLimit, async (c) => {
    const { errors, input, photo } = await readForm(c);
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    const t = store.create(input, photo);
    return c.json({ id: t.id }, 201);
  });

  app.post('/admin/api/tributes/:id', uploadLimit, async (c) => {
    const { errors, input, photo, removePhoto } = await readForm(c);
    if (Object.keys(errors).length) return c.json({ errors }, 400);
    const change: PhotoChange = photo ? { kind: 'replace', data: photo } : removePhoto ? { kind: 'remove' } : { kind: 'keep' };
    const t = store.update(c.req.param('id'), input, change);
    return t ? c.json({ id: t.id }) : c.json({ error: 'not_found' }, 404);
  });

  app.post('/admin/api/tributes/:id/delete', smallBody, (c) => {
    return store.delete(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/admin/api/')) return c.json({ error: 'not_found' }, 404);
    return c.html(pages.notFoundPage(assets.href('admin.css')), 404);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.text('서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.', 500);
  });

  return app;
}
