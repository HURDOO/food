// 페이지 하나를 이루는 파일 묶음의 규칙. 서버와 올리기 스크립트가 같이 쓴다.
// 하위 폴더 없이 한 폴더에 평평하게 두고, 이름은 소문자·숫자·-·_만 쓴다.

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 28 * 1024 * 1024;

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  woff2: 'font/woff2',
};

export const FILE_NAME = new RegExp(`^[a-z0-9][a-z0-9_-]{0,63}\\.(${Object.keys(CONTENT_TYPES).join('|')})$`);

export const contentType = (name: string) => CONTENT_TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

export interface BundleFile {
  name: string;
  data: Buffer;
}

/** 묶음이 규칙에 맞는지 본다. 맞으면 빈 배열, 아니면 사람이 읽을 이유들을 돌려준다. */
export function checkBundle(files: readonly BundleFile[]): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (!FILE_NAME.test(f.name)) problems.push(`${f.name}: 파일 이름은 소문자·숫자·-·_와 허용된 확장자만 쓸 수 있어요`);
    if (names.has(f.name)) problems.push(`${f.name}: 같은 이름이 두 번 있어요`);
    if (f.data.length > MAX_FILE_BYTES) problems.push(`${f.name}: 파일 하나는 ${MAX_FILE_BYTES / 1024 / 1024}MB까지예요`);
    names.add(f.name);
    total += f.data.length;
  }
  if (!names.has('index.html')) problems.push('index.html이 없어요');
  if (files.length > MAX_FILES) problems.push(`파일은 ${MAX_FILES}개까지예요`);
  if (total > MAX_BUNDLE_BYTES) problems.push(`전체 크기는 ${MAX_BUNDLE_BYTES / 1024 / 1024}MB까지예요`);
  return problems;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const squash = (s: string) => decodeEntities(s.replace(/\s+/g, ' ').trim());

/** index.html의 <title>을 목록 제목으로 쓴다. */
export function readTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return squash(m?.[1] ?? '').slice(0, 80) || '제목 없음';
}

/** <meta property|name="..." content="...">의 content. 속성 순서는 상관없다. */
function readMetaContent(html: string, names: readonly string[]): string {
  for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (content) return squash(content[1] ?? content[2] ?? '');
  }
  return '';
}

/** 홈 카드 설명. og:description, 없으면 description. */
export function readDescription(html: string): string {
  return readMetaContent(html, ['og:description', 'description']).slice(0, 120);
}

const IMAGE_FILE = /\.(jpe?g|png|gif|svg)$/;

/** 홈 카드 사진. 같은 묶음 안의 파일을 가리키는 og:image(`%PAGE_URL%photo.jpg`)만 쓴다. */
export function readCover(html: string): string | null {
  const src = readMetaContent(html, ['og:image']).replace(/^%PAGE_URL%/, '').replace(/^\.\//, '');
  return FILE_NAME.test(src) && IMAGE_FILE.test(src) ? src : null;
}

/**
 * index.html 안의 자리표시자를 채운다.
 *   %PAGE_URL%  페이지 주소 (끝에 / 포함). 카톡 미리보기 이미지처럼 절대 주소가 필요할 때 쓴다.
 *   %VIEWS%     지금까지 조회수
 */
export function fillPlaceholders(html: string, values: { pageUrl: string; views: number }): string {
  return html.replaceAll('%PAGE_URL%', values.pageUrl).replaceAll('%VIEWS%', String(values.views));
}
