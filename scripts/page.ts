// 페이지 만들기·올리기
//   pnpm page new <이름> [--from sample]     examples/<from>을 pages/<이름>으로 복사
//   pnpm page push <이름> [--to <주소>]      pages/<이름>을 서버에 올린다 (기본 https://food.app.hurdoo.kr)
//
// 올릴 때 사진은 긴 쪽 1600px로 줄이고(macOS sips) 위치정보를 지운다. kit.js·kit.css는 지금 빌드본을 같이 넣는다.
// 같은 서버에 다시 올리면 같은 주소를 유지한다 (pages/<이름>/.push.json에 서버별 페이지 id를 적어 둔다).
// 비밀번호: 로컬·내부망 개발 서버는 'dev', 그 밖의 서버는 macOS 키체인(서비스 food-admin, 계정 = 서버 호스트)에서 읽는다.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkBundle, FILE_NAME, type BundleFile } from '../src/server/bundle.ts';
import { cleanMedia, MediaError } from '../src/server/media.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const DEFAULT_TARGET = 'https://food.app.hurdoo.kr';
const MAX_SIDE = 1600;
const KIT_FILES = ['kit.js', 'kit.css'];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---------- new ----------

function newPage(slug: string, from: string) {
  if (!SLUG.test(slug)) fail('이름은 소문자·숫자·-만 쓸 수 있어요 (예: minsu-1111)');
  const src = join(ROOT, 'examples', from);
  const dest = join(ROOT, 'pages', slug);
  if (!existsSync(join(src, 'index.html'))) fail(`examples/${from}이 없어요`);
  if (existsSync(dest)) fail(`pages/${slug}가 이미 있어요`);
  cpSync(src, dest, { recursive: true });
  console.log(`✓ pages/${slug}를 만들었어요 (examples/${from} 복사)`);
  console.log(`  미리보기: pnpm dev 켜고 http://localhost:3000/dev/${slug}/`);
}

// ---------- push ----------

/** 사진의 긴 쪽이 MAX_SIDE보다 크면 sips로 줄인 사본을 돌려준다. sips가 없으면 원본 그대로. */
function shrinkIfLarge(file: string, workDir: string): string {
  try {
    const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const w = Number(/pixelWidth: (\d+)/.exec(info)?.[1]);
    const h = Number(/pixelHeight: (\d+)/.exec(info)?.[1]);
    if (!(Math.max(w, h) > MAX_SIDE)) return file;
    const out = join(workDir, file.split('/').pop() as string);
    execFileSync('sips', ['-Z', String(MAX_SIDE), file, '--out', out], { stdio: 'ignore' });
    console.log(`  ${file.split('/').pop()}: ${w}×${h} → 긴 쪽 ${MAX_SIDE}px`);
    return out;
  } catch {
    return file;
  }
}

function collect(dir: string): BundleFile[] {
  const work = mkdtempSync(join(tmpdir(), 'food-page-'));
  try {
    const files: BundleFile[] = [];
    const problems: string[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name.endsWith('.md')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        problems.push(`${name}/: 하위 폴더는 안 돼요. 파일을 페이지 폴더에 바로 두세요`);
        continue;
      }
      if (KIT_FILES.includes(name)) {
        problems.push(`${name}: 공용 도구 이름이라 쓸 수 없어요`);
        continue;
      }
      if (!FILE_NAME.test(name)) {
        problems.push(`${name}: 이름은 소문자·숫자·-·_와 허용된 확장자만 돼요 (heic·webp는 jpg로 바꿔 주세요)`);
        continue;
      }
      const isPhoto = /\.(jpe?g|png)$/.test(name);
      const source = isPhoto ? shrinkIfLarge(path, work) : path;
      try {
        files.push({ name, data: cleanMedia(name, readFileSync(source)) });
      } catch (err) {
        if (!(err instanceof MediaError)) throw err;
        problems.push(`${name}: 사진을 읽지 못했어요`);
      }
    }
    for (const name of KIT_FILES) {
      const path = join(ROOT, 'dist', 'kit', name);
      if (!existsSync(path)) fail('dist/kit가 없어요. pnpm build를 먼저 해 주세요');
      files.push({ name, data: readFileSync(path) });
    }
    problems.push(...checkBundle(files));
    if (problems.length) fail(`올릴 수 없어요\n  ${problems.join('\n  ')}`);
    return files;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const isDevHost = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /^(10|127)\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);

function passwordFor(target: URL): string {
  if (isDevHost(target.hostname)) return 'dev';
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'food-admin', '-a', target.host, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\n$/, '');
  } catch {
    fail(
      `키체인에 ${target.host} 관리자 비밀번호가 없어요. 터미널에서 한 번만 저장해 주세요 (입력은 화면에 안 보여요):\n` +
        `  security add-generic-password -s food-admin -a ${target.host} -w`,
    );
  }
}

async function upload(target: URL, password: string, files: BundleFile[], id: string | undefined) {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([new Uint8Array(f.data)]), f.name);
  const url = new URL(id ? `/api/pages/${id}` : '/api/pages', target);
  const res = await fetch(url, { method: id ? 'PUT' : 'POST', headers: { authorization: `Bearer ${password}` }, body: form });
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: string; problems?: string[] };
  return { status: res.status, body };
}

async function pushPage(slug: string, to: string) {
  if (!SLUG.test(slug)) fail('이름은 소문자·숫자·-만 쓸 수 있어요');
  const dir = join(ROOT, 'pages', slug);
  if (!existsSync(join(dir, 'index.html'))) fail(`pages/${slug}/index.html이 없어요`);
  let target: URL;
  try {
    target = new URL(to);
  } catch {
    fail(`주소가 이상해요: ${to}`);
  }

  console.log('· 공용 도구 빌드');
  const built = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) fail('빌드에 실패했어요');

  console.log(`· pages/${slug} 정리`);
  const files = collect(dir);
  const total = files.reduce((n, f) => n + f.data.length, 0);
  console.log(`  파일 ${files.length}개, ${(total / 1024 / 1024).toFixed(1)}MB`);

  const recordFile = join(dir, '.push.json');
  const record = existsSync(recordFile) ? (JSON.parse(readFileSync(recordFile, 'utf8')) as Record<string, string>) : {};
  const password = passwordFor(target);
  let id = record[target.origin];

  console.log(`· ${target.origin}에 ${id ? '다시 ' : ''}올리기`);
  let res = await upload(target, password, files, id);
  if (id && res.status === 404) {
    console.log('  서버에 예전 페이지가 없어서 새 주소로 올려요');
    id = undefined;
    res = await upload(target, password, files, undefined);
  }
  if (res.status === 401) fail('비밀번호가 맞지 않아요');
  if (res.status === 429) fail('비밀번호를 너무 많이 틀렸어요. 15분 뒤에 다시 해 주세요');
  if (res.status >= 400 || !res.body.id) fail(`올리지 못했어요 (${res.status})${res.body.problems ? `\n  ${res.body.problems.join('\n  ')}` : ''}`);

  record[target.origin] = res.body.id;
  writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`✓ ${id ? '고쳤어요 (주소 그대로)' : '올렸어요'}`);
  console.log(`  ${res.body.url}`);
}

// ---------- main ----------

const [command, slug, ...rest] = process.argv.slice(2);
if (command === 'new' && slug) newPage(slug, option(rest, '--from') ?? 'sample');
else if (command === 'push' && slug) await pushPage(slug, option(rest, '--to') ?? process.env.FOOD_URL ?? DEFAULT_TARGET);
else {
  console.log('사용법:\n  pnpm page new <이름> [--from sample]\n  pnpm page push <이름> [--to <서버 주소>]');
  process.exit(command ? 1 : 0);
}
