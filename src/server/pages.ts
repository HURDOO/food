// 서버가 그리는 HTML 페이지들. 사용자 입력은 전부 escapeHtml을 거친다.

import { renderScenes } from '../shared/scenes.ts';
import { escapeHtml as e, type Tribute, type TributeView } from '../shared/tribute.ts';

export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Gaegu:wght@700&family=Nanum+Gothic+Coding:wght@400;700&family=Nanum+Myeongjo:wght@400;800&display=swap';

const fontLinks = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">`;

/** JSON을 <script type="application/json"> 안에 넣어도 안전하게 만든다. */
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export const STICKER_TEXTS = (senior: string) => [`🐯 ${senior} 선배님 헌정관`, '⚠ 선배님만 누르세요', '밥약일보 속보 보기', '은혜 영수증 발급됨'];

export const MENTS: ReadonlyArray<[string, string]> = [
  ['과장', '선배님 카드 꺼내실 때 후광이 비쳐서 식당 조명 하나 꺼도 될 뻔했습니다'],
  ['말장난', '선배님은 은(Ag)으로 만들어진 게 분명해요. 왜냐고요? 너무 은혜로우셔서'],
  ['고대 드립', '호랑이는 죽어서 가죽을 남기고, 선배님은 밥약으로 전설을 남기십니다'],
  ['고대 드립', '고연전 응원보다 오늘 밥약이 더 벅찼습니다 (진심)'],
  ['메뉴', '메뉴 고르라고 하신 순간, 인생에서 처음으로 선택권을 존중받았습니다'],
  ['메뉴', '오늘 먹은 것 중 제일 맛있던 건 선배님의 "편하게 먹어" 한마디'],
  ['과장', '밥은 제가 먹었는데 왜 선배님이 빛나시죠'],
  ['과장', '오늘부로 제 위장 지분 100%는 선배님 소유입니다'],
  ['보은', '2밥약 1보은이 국룰이지만, 선배님께는 1밥약 10보은 하겠습니다'],
  ['보은', '은혜 갚은 까치는 종을 쳤고, 저는 사이트를 만들었습니다'],
];

// ---------- 헌정관 ----------

export function tributePage(opts: {
  tribute: Tribute;
  view: TributeView;
  baseUrl: string;
  cssHref: string;
  script: string;
}): string {
  const { tribute: t, view: v, baseUrl } = opts;
  const url = `${baseUrl}/h/${t.id}`;
  const title = `${v.senior} 선배님 헌정관`;
  const desc = `${v.junior}${v.juniorGa} 올리는 밥약 감사 헌정관 · ${v.dateDot} ${v.menu}`;
  const ogImage = t.photo ? `<meta property="og:image" content="${e(`${baseUrl}/p/${t.photo}`)}">\n<meta name="twitter:card" content="summary_large_image">` : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0B0A3B">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${e(url)}">
${ogImage}
${fontLinks}
<link rel="stylesheet" href="${e(opts.cssHref)}">
</head>
<body class="t-body">
<main class="stage" id="stage" data-id="${e(t.id)}">
${renderScenes(v, 'live', 0)}
</main>
<script>${opts.script}</script>
</body>
</html>`;
}

function simplePage(title: string, cssHref: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
${fontLinks}
<link rel="stylesheet" href="${e(cssHref)}">
</head>
<body class="a-body a-center">
<main class="a-lone">${body}</main>
</body>
</html>`;
}

export const homePage = (cssHref: string) =>
  simplePage(
    '은혜 갚는 호랑이',
    cssHref,
    `<p class="a-emoji" aria-hidden="true">🐯</p><h1 class="a-brand-lg">은혜 갚는 호랑이</h1><p class="a-muted">선배님 헌정관은 받은 링크로만 들어올 수 있어요.</p>`,
  );

export const notFoundPage = (cssHref: string) =>
  simplePage(
    '헌정관을 찾을 수 없어요',
    cssHref,
    `<p class="a-emoji" aria-hidden="true">🐯</p><h1 class="a-brand-lg">헌정관을 찾을 수 없어요</h1><p class="a-muted">주소가 틀렸거나, 헌정관이 철거됐어요.</p>`,
  );

// ---------- 관리자 ----------

function adminPage(opts: { title: string; cssHrefs: string[]; scriptHref?: string; body: string; data?: unknown; nav?: boolean }): string {
  const nav = opts.nav === false
    ? ''
    : `<header class="a-top">
<a class="a-brand" href="/admin">은혜 갚는 호랑이</a>
<form method="post" action="/admin/logout"><button type="submit" class="a-btn a-btn-ghost a-btn-sm">로그아웃</button></form>
</header>`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${opts.title} · 은혜 갚는 호랑이</title>
<meta name="robots" content="noindex, nofollow">
${fontLinks}
${opts.cssHrefs.map((h) => `<link rel="stylesheet" href="${e(h)}">`).join('\n')}
${opts.scriptHref ? `<script type="module" src="${e(opts.scriptHref)}"></script>` : ''}
</head>
<body class="a-body">
<div class="a-wrap">
${nav}
${opts.body}
</div>
${opts.data === undefined ? '' : `<script type="application/json" id="page-data">${jsonForScript(opts.data)}</script>`}
<div class="a-toast" id="toast" role="status" hidden></div>
</body>
</html>`;
}

export function loginPage(cssHref: string, error: string | null): string {
  return adminPage({
    title: '로그인',
    cssHrefs: [cssHref],
    nav: false,
    body: `<main class="a-login">
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

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
};

function statChips(t: Tribute): string {
  const chips = [`<span class="a-chip">조회 ${t.stats.views}</span>`];
  chips.push(t.stats.agreedAt ? `<span class="a-chip a-chip-ok">또 사주기 약속함</span>` : `<span class="a-chip">약속 전</span>`);
  chips.push(t.stats.coupon ? `<span class="a-chip a-chip-ok">보은: ${e(t.stats.coupon)}</span>` : `<span class="a-chip">보은 미선택</span>`);
  return `<div class="a-chips">${chips.join('')}</div>`;
}

const thumb = (t: Tribute, foodEmoji: string) =>
  t.photo
    ? `<img class="a-thumb" src="/p/${e(t.photo)}" alt="" loading="lazy">`
    : `<span class="a-thumb a-thumb-empty" aria-hidden="true">${foodEmoji}</span>`;

export function adminListPage(opts: { cssHref: string; scriptHref: string; baseUrl: string; items: Array<{ tribute: Tribute; food: string }> }): string {
  const list = opts.items.length
    ? `<ul class="a-list">${opts.items
        .map(({ tribute: t, food }) => {
          const url = `${opts.baseUrl}/h/${t.id}`;
          return `<li class="a-card a-item">
${thumb(t, food)}
<div class="a-item-main">
<p class="a-item-title"><a href="/admin/t/${e(t.id)}">${e(t.senior)} 선배님</a></p>
<p class="a-muted a-small">${e(t.date)} · ${e(t.menu)}</p>
${statChips(t)}
<div class="a-actions">
<button type="button" class="a-btn a-btn-sm" data-copy="${e(url)}">링크 복사</button>
<a class="a-btn a-btn-sm a-btn-ghost" href="/h/${e(t.id)}" target="_blank" rel="noopener">열기</a>
<a class="a-btn a-btn-sm a-btn-ghost" href="/admin/t/${e(t.id)}/edit">수정</a>
</div>
</div>
</li>`;
        })
        .join('')}</ul>`
    : `<div class="a-card a-empty"><p class="a-emoji" aria-hidden="true">🍜</p><p>아직 만든 헌정관이 없어요.<br>밥약 끝나고 바로 하나 만들어 보세요.</p></div>`;
  return adminPage({
    title: '헌정관 목록',
    cssHrefs: [opts.cssHref],
    scriptHref: opts.scriptHref,
    body: `<div class="a-head"><h1 class="a-h1">헌정관</h1><a class="a-btn a-btn-primary" href="/admin/new">새로 만들기</a></div>
${list}`,
  });
}

const field = (id: string, label: string, input: string, hint = '') =>
  `<div class="a-field" data-field="${id}"><label class="a-label" for="f-${id}">${label}</label>${input}${hint ? `<p class="a-hint">${hint}</p>` : ''}<p class="a-error" data-error-for="${id}" hidden></p></div>`;

export function adminFormPage(opts: { cssHrefs: string[]; scriptHref: string; tribute: Tribute | null }): string {
  const t = opts.tribute;
  const editing = Boolean(t);
  const textInput = (id: string, attrs: string) => `<input class="a-input" type="text" id="f-${id}" name="${id}" ${attrs}>`;
  const levels = [
    [1, '예의 바름'],
    [2, '주접'],
    [3, '광기'],
  ]
    .map(([n, name]) => `<input type="radio" name="level" id="f-level-${n}" value="${n}"><label for="f-level-${n}">${n}<small>${name}</small></label>`)
    .join('');

  const form = `<form class="a-card a-form" id="tribute-form" novalidate>
<div class="a-grid2">
${field('senior', '선배 이름', textInput('senior', 'maxlength="12" placeholder="김호랑" autocomplete="off" required'), '"선배님"은 자동으로 붙어요.')}
${field('junior', '내 이름', textInput('junior', 'maxlength="12" placeholder="이새내" autocomplete="off" required'))}
${field('major', '선배 학과', textInput('major', 'maxlength="16" placeholder="경영학과" autocomplete="off"'))}
${field('year', '선배 학번', textInput('year', 'maxlength="2" inputmode="numeric" placeholder="22" autocomplete="off"'))}
</div>
${field('menu', '먹은 메뉴', textInput('menu', 'maxlength="30" placeholder="마라탕이랑 꿔바로우" autocomplete="off" required'))}
<div class="a-grid2">
${field('place', '장소', textInput('place', 'maxlength="16" placeholder="참살이길" autocomplete="off"'))}
${field('date', '날짜', '<input class="a-input" type="date" id="f-date" name="date" required>')}
</div>
${field('price', '금액 (원)', `${textInput('price', 'inputmode="numeric" maxlength="9" placeholder="38000" autocomplete="off"')}<label class="a-check" for="f-showPrice"><input type="checkbox" id="f-showPrice" name="showPrice" value="1"> 영수증에 금액 공개</label>`, '공개하지 않으면 영수증에 "비공개"로 나와요.')}
${field('note', '한마디', '<textarea class="a-input" id="f-note" name="note" rows="2" maxlength="60" placeholder="선배님 덕분에 배도 마음도 꽉 찼습니다"></textarea>', '속보 기사에 후배 인터뷰로 들어가요.')}
<div class="a-field" data-field="photo">
<span class="a-label" id="photo-label">밥약 사진</span>
<div class="a-photo">
<img id="photo-preview" alt="고른 사진 미리보기" hidden>
<label class="a-photo-pick" for="f-photo" id="photo-pick">사진 고르기</label>
<input class="a-visually-hidden" type="file" id="f-photo" accept="image/*" aria-labelledby="photo-label">
</div>
<div class="a-actions"><button type="button" class="a-btn a-btn-sm a-btn-ghost" id="photo-change" hidden>다른 사진</button><button type="button" class="a-btn a-btn-sm a-btn-ghost" id="photo-remove" hidden>사진 빼기</button></div>
<p class="a-hint">속보 기사 사진과 카톡 미리보기에 써요. 위치정보는 지우고 저장해요.</p>
<p class="a-error" data-error-for="photo" hidden></p>
</div>
<fieldset class="a-field a-levels">
<legend class="a-label">주접 레벨</legend>
<div class="a-seg">${levels}</div>
<p class="a-hint">처음 본 선배는 1, 과·동아리 선배는 2, 친한 선배는 3.</p>
</fieldset>
<p class="a-error" id="form-error" role="alert" hidden></p>
<div class="a-actions a-submit">
<button type="submit" class="a-btn a-btn-primary" id="submit">${editing ? '저장하기' : '헌정관 만들기'}</button>
${editing ? `<a class="a-btn a-btn-ghost" href="/admin/t/${e(t!.id)}">취소</a>` : `<a class="a-btn a-btn-ghost" href="/admin">취소</a>`}
</div>
</form>`;

  const preview = `<section class="a-preview" aria-label="미리보기">
<div class="a-preview-head"><p class="a-label">미리보기</p><div class="a-tabs" id="pv-tabs" role="tablist"></div></div>
<div class="pv-frame" id="pv-frame"><div class="pv-phone" id="pv-phone"></div></div>
</section>`;

  return adminPage({
    title: editing ? '헌정관 수정' : '새 헌정관',
    cssHrefs: opts.cssHrefs,
    scriptHref: opts.scriptHref,
    body: `<div class="a-head"><h1 class="a-h1">${editing ? `${e(t!.senior)} 선배님 헌정관 수정` : '새 헌정관'}</h1></div>
<div class="a-editor">${form}${preview}</div>`,
    data: {
      mode: editing ? 'edit' : 'new',
      tribute: t,
      photoUrl: t?.photo ? `/p/${t.photo}` : null,
    },
  });
}

export function adminSharePage(opts: { cssHref: string; scriptHref: string; baseUrl: string; tribute: Tribute; justCreated: boolean }): string {
  const t = opts.tribute;
  const url = `${opts.baseUrl}/h/${t.id}`;
  const copyChip = (text: string) => `<button type="button" class="a-chip a-chip-btn" data-copy="${e(text)}">${e(text)}</button>`;
  const ments = MENTS.map(
    ([kind, text]) => `<li><span class="a-muted a-small">${kind}</span><p>${e(text)}</p><button type="button" class="a-btn a-btn-sm a-btn-ghost" data-copy="${e(text)}">복사</button></li>`,
  ).join('');
  const reaction = [
    `<li><span>조회수</span><b>${t.stats.views}</b></li>`,
    `<li><span>"또 사주실 거죠?"</span><b>${t.stats.agreedAt ? `네! (${e(fmtDateTime(t.stats.agreedAt))})` : '아직'}</b></li>`,
    `<li><span>보은권 선택</span><b>${t.stats.coupon ? `${e(t.stats.coupon)} (${e(fmtDateTime(t.stats.couponAt))})` : '아직'}</b></li>`,
  ].join('');

  return adminPage({
    title: `${t.senior} 선배님 헌정관`,
    cssHrefs: [opts.cssHref],
    scriptHref: opts.scriptHref,
    body: `<div class="a-head"><h1 class="a-h1">${opts.justCreated ? '헌정관 완성!' : `${e(t.senior)} 선배님 헌정관`}</h1></div>
<section class="a-card a-stack">
<p class="a-label">헌정관 링크</p>
<p class="a-url" id="share-url">${e(url)}</p>
<div class="a-actions">
<button type="button" class="a-btn a-btn-primary" data-copy="${e(url)}">링크 복사</button>
<a class="a-btn a-btn-ghost" href="/h/${e(t.id)}" target="_blank" rel="noopener">열어보기</a>
<a class="a-btn a-btn-ghost" href="/admin/t/${e(t.id)}/edit">수정</a>
</div>
</section>

<section class="a-section">
<h2 class="a-h2">스토리에 올리기</h2>
<ol class="a-steps">
<li>음식 사진으로 스토리를 올리고 선배를 태그해요.</li>
<li>아래 멘트 중 하나를 한 줄로 써요.</li>
<li>링크 스티커에 위 링크를 붙이고, 스티커 문구를 바꿔요.</li>
</ol>
<p class="a-label">스티커 문구 (누르면 복사)</p>
<div class="a-chips">${STICKER_TEXTS(t.senior).map(copyChip).join('')}</div>
</section>

<section class="a-section">
<h2 class="a-h2">감사 멘트</h2>
<ul class="a-ments">${ments}</ul>
</section>

<section class="a-section">
<h2 class="a-h2">선배 반응</h2>
<ul class="a-stats">${reaction}</ul>
<p class="a-hint">내가 로그인한 상태로 열어 본 건 조회수에 안 들어가요.</p>
</section>

<section class="a-section a-danger-zone">
<button type="button" class="a-btn a-btn-ghost a-btn-danger" id="delete-start">헌정관 삭제</button>
<div class="a-confirm" id="delete-confirm" hidden>
<p>사진과 반응 기록까지 모두 지워져요. 되돌릴 수 없어요.</p>
<div class="a-actions"><button type="button" class="a-btn a-btn-danger-solid" id="delete-yes" data-id="${e(t.id)}">삭제</button><button type="button" class="a-btn a-btn-ghost" id="delete-no">취소</button></div>
<p class="a-error" id="delete-error" hidden></p>
</div>
</section>`,
  });
}
