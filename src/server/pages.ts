// 서버가 그리는 관리용 HTML. 바깥에서 온 글자는 전부 e()를 거친다.

import type { PageMeta } from './store.ts';

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const e = escapeHtml;

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap';
const fontLinks = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">`;

function shell(opts: { title: string; cssHref: string; scriptHref?: string; body: string; nav?: boolean; center?: boolean }): string {
  const nav = opts.nav
    ? `<header class="a-top">
<a class="a-brand" href="/admin">은혜 갚는 호랑이</a>
<form method="post" action="/admin/logout"><button type="submit" class="a-btn a-btn-ghost a-btn-sm">로그아웃</button></form>
</header>`
    : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(opts.title)}</title>
<meta name="robots" content="noindex, nofollow">
${fontLinks}
<link rel="stylesheet" href="${e(opts.cssHref)}">
${opts.scriptHref ? `<script type="module" src="${e(opts.scriptHref)}"></script>` : ''}
</head>
<body class="a-body${opts.center ? ' a-center' : ''}">
<div class="a-wrap">
${nav}
${opts.body}
</div>
<div class="a-toast" id="toast" role="status" hidden></div>
</body>
</html>`;
}

export const homePage = (cssHref: string) =>
  shell({
    title: '은혜 갚는 호랑이',
    cssHref,
    center: true,
    body: `<main class="a-lone"><p class="a-emoji" aria-hidden="true">🐯</p><h1 class="a-brand-lg">은혜 갚는 호랑이</h1><p class="a-muted">받은 링크로만 들어올 수 있어요.</p></main>`,
  });

export const notFoundPage = (cssHref: string) =>
  shell({
    title: '페이지를 찾을 수 없어요',
    cssHref,
    center: true,
    body: `<main class="a-lone"><p class="a-emoji" aria-hidden="true">🐯</p><h1 class="a-brand-lg">페이지를 찾을 수 없어요</h1><p class="a-muted">주소가 틀렸거나, 페이지가 내려갔어요.</p></main>`,
  });

export function loginPage(cssHref: string, error: string | null): string {
  return shell({
    title: '로그인 · 은혜 갚는 호랑이',
    cssHref,
    center: true,
    body: `<main class="a-lone">
<p class="a-emoji" aria-hidden="true">🐯</p>
<h1 class="a-brand-lg">은혜 갚는 호랑이</h1>
<form method="post" action="/admin/login" class="a-card a-stack">
<label class="a-label" for="password">관리자 비밀번호</label>
<input class="a-input" type="password" id="password" name="password" autocomplete="current-password" required autofocus>
${error ? `<p class="a-error" role="alert">${e(error)}</p>` : ''}
<button type="submit" class="a-btn a-btn-primary">들어가기</button>
</form>
</main>`,
  });
}

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

function reactionList(meta: PageMeta): string {
  const entries = Object.entries(meta.reactions).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt));
  if (!entries.length) return '<p class="a-muted a-small">아직 반응이 없어요</p>';
  return `<ul class="a-stats">${entries
    .map(([key, r]) => {
      const times = r.count > 1 ? ` <span class="a-muted">×${r.count}</span>` : '';
      return `<li><span>${e(key)}</span><b>${r.value ? e(r.value) : '눌렀음'}${times} <span class="a-muted a-small">${e(fmtDateTime(r.lastAt))}</span></b></li>`;
    })
    .join('')}</ul>`;
}

export function adminListPage(opts: { cssHref: string; scriptHref: string; baseUrl: string; pages: PageMeta[] }): string {
  const list = opts.pages.length
    ? `<ul class="a-list">${opts.pages
        .map((p) => {
          const url = `${opts.baseUrl}/h/${p.id}/`;
          return `<li class="a-card a-item" data-page="${e(p.id)}">
<div class="a-item-head">
<p class="a-item-title">${e(p.title)}</p>
<span class="a-chip">조회 ${p.views}</span>
</div>
<p class="a-url">${e(url)}</p>
<p class="a-muted a-small">올린 날 ${e(fmtDateTime(p.createdAt))}${p.updatedAt !== p.createdAt ? ` · 고친 날 ${e(fmtDateTime(p.updatedAt))}` : ''}</p>
${reactionList(p)}
<div class="a-actions">
<button type="button" class="a-btn a-btn-sm a-btn-primary" data-copy="${e(url)}">링크 복사</button>
<a class="a-btn a-btn-sm a-btn-ghost" href="/h/${e(p.id)}/" target="_blank" rel="noopener">열기</a>
<button type="button" class="a-btn a-btn-sm a-btn-ghost a-btn-danger" data-delete-start>내리기</button>
</div>
<div class="a-confirm" data-delete-confirm hidden>
<p>페이지와 조회수·반응 기록이 모두 지워져요. 되돌릴 수 없어요.</p>
<div class="a-actions"><button type="button" class="a-btn a-btn-sm a-btn-danger-solid" data-delete-yes>내리기</button><button type="button" class="a-btn a-btn-sm a-btn-ghost" data-delete-no>취소</button></div>
<p class="a-error" data-delete-error hidden></p>
</div>
</li>`;
        })
        .join('')}</ul>`
    : `<div class="a-card a-empty"><p class="a-emoji" aria-hidden="true">🍜</p><p>아직 올린 페이지가 없어요.</p></div>`;
  return shell({
    title: '페이지 · 은혜 갚는 호랑이',
    cssHref: opts.cssHref,
    scriptHref: opts.scriptHref,
    nav: true,
    body: `<div class="a-head"><h1 class="a-h1">올린 페이지</h1></div>
${list}
<p class="a-hint">내가 로그인한 채로 열거나 누른 건 조회수와 반응에 안 들어가요.</p>`,
  });
}

export function devIndexPage(cssHref: string, items: Array<{ slug: string; group: string }>): string {
  const rows = items.length
    ? `<ul class="a-list">${items
        .map((i) => `<li class="a-card a-item"><p class="a-item-title"><a href="/dev/${e(i.slug)}/">${e(i.slug)}</a></p><p class="a-muted a-small">${e(i.group)}</p></li>`)
        .join('')}</ul>`
    : '<div class="a-card a-empty"><p>미리 볼 페이지가 없어요.</p></div>';
  return shell({
    title: '개발 미리보기',
    cssHref,
    body: `<div class="a-head"><h1 class="a-h1">개발 미리보기</h1></div>${rows}<p class="a-hint">파일을 고치고 새로고침하면 바로 보여요. 여기서는 조회수와 반응을 남기지 않아요.</p>`,
  });
}
