import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Assets } from './assets.ts';
import { createLoginLimiter, SESSION_COOKIE, SESSION_DAYS, type Auth } from './auth.ts';
import { checkBundle, contentType, FILE_NAME, fillPlaceholders, MAX_BUNDLE_BYTES, readCover, readDescription, readTitle, type BundleFile } from './bundle.ts';
import type { Config } from './config.ts';
import { cleanMedia, MediaError } from './media.ts';
import * as views from './pages.ts';
import { type FileStore, MAX_COUNT_STEP, REACTION_KEY } from './store.ts';

// 링크 미리보기를 만드는 봇은 조회수와 반응에 넣지 않는다.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|preview|headless|curl|wget/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

// 손으로 만든 페이지용. 스크립트는 같이 올린 파일만 돌고, 글꼴은 구글 폰트와 jsDelivr(눈누 글꼴)에서 받을 수 있다.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

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
  const css = () => assets.href('admin.css');

  const isAdmin = (c: Context) => auth.verify(getCookie(c, SESSION_COOKIE));
  const isBot = (c: Context) => BOT_UA.test(c.req.header('user-agent') ?? '');
  const pageUrl = (id: string) => `${config.baseUrl}/h/${id}/`;

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'DENY');
    if (!c.res.headers.has('Content-Security-Policy')) c.header('Content-Security-Policy', ADMIN_CSP);
  });

  // 다른 사이트에서 보낸 쓰기 요청은 막는다 (관리자 쿠키는 SameSite=Lax라 이중 안전장치).
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
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

  // 공개 홈: 올린 밥약 페이지 목록. 카드 내용은 각 페이지의 <title>, og:description, og:image에서 뽑는다.
  app.get('/', (c) => {
    const cards = store.list().map((meta) => {
      const html = store.readFile(meta.id, 'index.html')?.data.toString('utf8') ?? '';
      const cover = readCover(html);
      return {
        id: meta.id,
        title: meta.title,
        description: readDescription(html),
        cover: cover && store.hasFile(meta.id, cover) ? cover : null,
        createdAt: meta.createdAt,
      };
    });
    c.header('Cache-Control', 'no-cache');
    return c.html(views.homePage(css(), cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  });

  app.get('/assets/:file', (c) => {
    const file = assets.file(c.req.param('file'));
    if (!file) return c.notFound();
    return c.body(new Uint8Array(file.body), 200, {
      'Content-Type': file.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  // ---------- 페이지 (링크 받은 사람용) ----------

  const sendIndex = (c: Context, html: string, url: string, views: number) => {
    c.header('Content-Security-Policy', PAGE_CSP);
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.html(fillPlaceholders(html, { pageUrl: url, views }));
  };

  const sendFile = (c: Context, name: string, data: Buffer, etag: string) => {
    c.header('Content-Security-Policy', PAGE_CSP);
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-cache');
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.body(new Uint8Array(data), 200, { 'Content-Type': contentType(name) });
  };

  app.get('/h/:id', (c) => {
    const id = c.req.param('id');
    return store.get(id) ? c.redirect(`/h/${id}/`, 308) : c.notFound();
  });

  app.get('/h/:id/', (c) => {
    const id = c.req.param('id');
    const found = store.readFile(id, 'index.html');
    if (!found) return c.notFound();
    const counted = !isAdmin(c) && !isBot(c);
    const meta = (counted && store.recordView(id)) || found.meta;
    return sendIndex(c, found.data.toString('utf8'), pageUrl(id), meta.views);
  });

  // 함께 쌓는 숫자 (좋아요 등). 읽기는 누구나, 더하기는 봇만 빼고. 파일 경로보다 먼저 둔다.
  app.get('/h/:id/counts', (c) => {
    const meta = store.get(c.req.param('id'));
    if (!meta) return c.notFound();
    c.header('Cache-Control', 'no-store');
    return c.json({ counts: meta.counts ?? {} });
  });

  app.get('/h/:id/:file', (c) => {
    const { id, file } = c.req.param();
    if (file === 'index.html') return store.get(id) ? c.redirect(`/h/${id}/`, 308) : c.notFound();
    const found = store.readFile(id, file);
    if (!found) return c.notFound();
    return sendFile(c, file, found.data, `"${found.meta.bundle}-${file}"`);
  });

  app.post('/h/:id/react', bodyLimit({ maxSize: 1024, onError: (c) => c.text('too large', 413) }), async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.notFound();
    let body: { key?: unknown; value?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    const key = typeof body.key === 'string' ? body.key : '';
    const value = typeof body.value === 'string' ? body.value : '';
    if (!/^[a-z0-9_-]{1,24}$/.test(key)) return c.json({ error: 'bad_key' }, 400);
    // 내가 열어 보거나 봇이 누른 건 남기지 않는다.
    if (!isAdmin(c) && !isBot(c)) store.recordReaction(id, key, value);
    return c.body(null, 204);
  });

  app.post('/h/:id/count', bodyLimit({ maxSize: 256, onError: (c) => c.text('too large', 413) }), async (c) => {
    const id = c.req.param('id');
    const meta = store.get(id);
    if (!meta) return c.notFound();
    let body: { key?: unknown; add?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    const key = typeof body.key === 'string' ? body.key : '';
    const add = typeof body.add === 'number' ? body.add : NaN;
    if (!REACTION_KEY.test(key) || !Number.isInteger(add) || add < 1 || add > MAX_COUNT_STEP) return c.json({ error: 'bad_input' }, 400);
    if (isBot(c)) return c.json({ total: meta.counts?.[key] ?? 0 });
    const total = store.addCount(id, key, add);
    return total === null ? c.json({ error: 'too_many_keys' }, 400) : c.json({ total });
  });

  // ---------- 개발 미리보기 (pnpm dev에서만) ----------

  if (config.devPageDirs.length) {
    const findDevDir = (slug: string) => {
      if (!SLUG.test(slug)) return null;
      for (const dir of config.devPageDirs) {
        try {
          readFileSync(join(dir, slug, 'index.html'));
          return join(dir, slug);
        } catch {
          // 다음 폴더에서 찾는다
        }
      }
      return null;
    };

    app.get('/dev', (c) => c.redirect('/dev/', 303));
    app.get('/dev/', (c) => {
      const items: Array<{ slug: string; group: string }> = [];
      for (const dir of config.devPageDirs) {
        try {
          for (const slug of readdirSync(dir).sort()) if (findDevDir(slug) === join(dir, slug)) items.push({ slug, group: basename(dir) });
        } catch {
          // 폴더가 아직 없으면 건너뛴다
        }
      }
      c.header('Cache-Control', 'no-store');
      return c.html(views.devIndexPage(css(), items));
    });
    app.get('/dev/:slug', (c) => c.redirect(`/dev/${c.req.param('slug')}/`, 303));
    app.get('/dev/:slug/', (c) => {
      const slug = c.req.param('slug');
      const dir = findDevDir(slug);
      if (!dir) return c.notFound();
      return sendIndex(c, readFileSync(join(dir, 'index.html'), 'utf8'), `${config.baseUrl}/dev/${slug}/`, 0);
    });
    app.get('/dev/:slug/:file', (c) => {
      const { slug, file } = c.req.param();
      const dir = findDevDir(slug);
      if (!dir || !FILE_NAME.test(file)) return c.notFound();
      for (const base of [dir, ...(file === 'kit.js' || file === 'kit.css' ? [config.kitDir] : [])]) {
        try {
          const data = readFileSync(join(base, file));
          c.header('Content-Security-Policy', PAGE_CSP);
          c.header('Cache-Control', 'no-store');
          return c.body(new Uint8Array(data), 200, { 'Content-Type': contentType(file) });
        } catch {
          // 페이지 폴더에 없으면 공용 도구 폴더를 본다
        }
      }
      return c.notFound();
    });
  }

  // ---------- 올리기 API (Mac의 올리기 스크립트용) ----------

  const apiAuth = async (c: Context, next: () => Promise<void>) => {
    if (limiter.blocked()) return c.json({ error: 'too_many_attempts' }, 429);
    const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
    if (!m || !auth.checkPassword(m[1] as string)) {
      limiter.fail();
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };

  const uploadLimit = bodyLimit({ maxSize: MAX_BUNDLE_BYTES + 2 * 1024 * 1024, onError: (c) => c.json({ error: 'too_large', problems: ['전체 크기가 너무 커요'] }, 413) });

  async function readBundle(c: Context): Promise<{ files: BundleFile[]; problems: string[] }> {
    const body = await c.req.parseBody({ all: true });
    const raw = body.files;
    const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((f): f is File => f instanceof File);
    const files: BundleFile[] = [];
    const problems: string[] = [];
    for (const f of list) {
      try {
        files.push({ name: f.name, data: cleanMedia(f.name, new Uint8Array(await f.arrayBuffer())) });
      } catch (err) {
        if (!(err instanceof MediaError)) throw err;
        problems.push(`${f.name}: 사진을 읽지 못했어요`);
      }
    }
    return { files, problems: [...problems, ...checkBundle(files)] };
  }

  const titleOf = (files: BundleFile[]) => readTitle(files.find((f) => f.name === 'index.html')?.data.toString('utf8') ?? '');

  app.post('/api/pages', apiAuth, uploadLimit, async (c) => {
    const { files, problems } = await readBundle(c);
    if (problems.length) return c.json({ error: 'bad_bundle', problems }, 400);
    const meta = store.create(titleOf(files), files);
    return c.json({ id: meta.id, url: pageUrl(meta.id) }, 201);
  });

  app.put('/api/pages/:id', apiAuth, uploadLimit, async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'not_found' }, 404);
    const { files, problems } = await readBundle(c);
    if (problems.length) return c.json({ error: 'bad_bundle', problems }, 400);
    const meta = store.replace(id, titleOf(files), files);
    return meta ? c.json({ id: meta.id, url: pageUrl(meta.id) }) : c.json({ error: 'not_found' }, 404);
  });

  // ---------- 관리자 ----------

  const smallBody = bodyLimit({ maxSize: 1024, onError: (c) => c.text('too large', 413) });

  app.get('/admin/login', (c) => (isAdmin(c) ? c.redirect('/admin', 303) : c.html(views.loginPage(css(), null))));

  app.post('/admin/login', smallBody, async (c) => {
    if (limiter.blocked()) return c.html(views.loginPage(css(), '시도가 너무 많아요. 15분 뒤에 다시 해 주세요.'), 429);
    const body = await c.req.parseBody();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || !auth.checkPassword(password)) {
      limiter.fail();
      return c.html(views.loginPage(css(), '비밀번호가 맞지 않아요.'), 401);
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

  app.get('/admin', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.html(views.adminListPage({ cssHref: css(), scriptHref: assets.href('admin.js'), baseUrl: config.baseUrl, pages: store.list() }));
  });

  app.post('/admin/api/pages/:id/delete', smallBody, (c) => {
    return store.delete(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/admin/api/') || c.req.path.startsWith('/api/')) return c.json({ error: 'not_found' }, 404);
    return c.html(views.notFoundPage(css()), 404);
  });

  app.onError((err, c) => {
    console.error(err);
    return c.text('서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.', 500);
  });

  return app;
}
