// 페이지 공용 도구. 페이지를 올릴 때 kit.js로 같이 들어간다.
// HTML에 data-* 속성만 달면 동작하고, 그 이상은 페이지 스크립트에서 window.kit으로 부른다.
//
//   <main data-story>                  인스타 스토리처럼 탭으로 넘기는 무대. 자식 .scene이 한 장면
//     data-w="280" data-h="580"        설계 크기 (기본 280×580). 화면에 맞춰 통째로 확대한다
//     data-bars="off"                  위쪽 진행 막대 끄기
//   <section class="scene" data-auto="3000">   3초 뒤 자동으로 다음 장면
//   <section class="scene" data-tap="off">     화면 탭으로 넘어가지 않는 장면
//
//   data-next / data-next="1500"       (바로 / 1.5초 뒤) 다음 장면
//   data-prev, data-go="0" / data-go="#end"    이전 장면, 특정 장면으로
//   data-show="id1 id2", data-hide="id"        숨긴 요소 보이기·숨기기
//   data-confetti / data-confetti="🍖,🍜"      꽃가루 (값을 주면 그 이모지가 쏟아진다)
//   data-react="key" (+ data-value)    반응 기록. 버튼은 누를 때, 입력·선택 상자는 바꿀 때
//   data-reset                         같은 장면의 도망 버튼과 data-show로 보인 것을 되돌린다
//   data-dodge / data-dodge="아니|진짜?"    누르려 하면 도망가는 버튼. data-arena 안에 둔다
//     data-grow (같은 arena 안)        도망칠수록 커지는 버튼
//     data-dodge-hint (같은 장면)      두 번 도망친 뒤 보이는 안내
//   data-counter="6"                   %VIEWS%를 LED 숫자 6칸으로 그린다
//
//   kit.counts()                       방문자 모두가 함께 쌓은 숫자들 { like: 128 } (못 읽으면 null)
//   kit.count('like', 5)               5를 더하고 새 합계를 받는다 (1~500, 못 보내면 null)
//     개발 미리보기에서는 서버 대신 이 브라우저(localStorage)에 쌓는다

type EnterFn = (scene: HTMLElement, index: number) => void;

interface ConfettiOptions {
  in?: Element | null;
  emoji?: string[];
  count?: number;
}

const DEFAULT_NO = ['아니요', '진짜요?', '다시 생각해 보세요', '버튼이 고장났어요', '…네?'];
const INTERACTIVE = 'button, a, input, label, select, textarea, [data-tap="off"], [data-arena]';

const root = document.documentElement;
root.classList.add('k-js');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 반응 기록 ----------

const pageId = /^\/h\/([A-Za-z0-9]{10})\//.exec(window.location.pathname)?.[1] ?? null;

function react(key: string, value: unknown = '') {
  const text = String(value ?? '').trim().slice(0, 80);
  if (!pageId) {
    // 개발 미리보기에서는 남기지 않는다.
    console.info('[kit] react', key, text);
    return;
  }
  fetch(`/h/${pageId}/react`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value: text }),
    keepalive: true,
  }).catch(() => {});
}

// ---------- 함께 쌓는 숫자 ----------

const devCountKey = `kit-counts:${window.location.pathname}`;

function devCounts(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(devCountKey) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

async function counts(): Promise<Record<string, number> | null> {
  if (!pageId) return devCounts();
  try {
    const res = await fetch(`/h/${pageId}/counts`, { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { counts: Record<string, number> }).counts;
  } catch {
    return null;
  }
}

async function count(key: string, add: number): Promise<number | null> {
  const n = Math.min(500, Math.max(1, Math.round(add)));
  if (!pageId) {
    const all = devCounts();
    all[key] = (all[key] ?? 0) + n;
    try {
      window.localStorage.setItem(devCountKey, JSON.stringify(all));
    } catch {
      // 미리보기라 못 남겨도 된다
    }
    return all[key];
  }
  try {
    const res = await fetch(`/h/${pageId}/count`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, add: n }),
      keepalive: true,
    });
    if (!res.ok) return null;
    return ((await res.json()) as { total: number }).total;
  } catch {
    return null;
  }
}

// ---------- 무대와 장면 ----------

const story = document.querySelector<HTMLElement>('[data-story]');
const scenes = story ? Array.from(story.querySelectorAll<HTMLElement>(':scope > .scene')) : [];
const designW = Number(story?.dataset.w) || 280;
const designH = Number(story?.dataset.h) || 580;
const enterFns: EnterFn[] = [];
let current = -1;
let autoTimer = 0;
let laterTimer = 0;

function fit() {
  if (!story) return;
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  const framed = vw / vh > 0.8;
  let k: number;
  let w: number;
  let h: number;
  let left = 0;
  let top = 0;
  if (!framed) {
    // 폰: 화면을 꽉 채운다. 남는 쪽(대개 세로)은 설계 크기보다 길어진다.
    k = Math.min(vw / designW, vh / designH);
    w = vw / k;
    h = vh / k;
  } else {
    // 데스크톱·가로 화면: 가운데에 폰 모양으로 띄운다.
    k = Math.min((vh - 32) / (designH + 20), 1.6);
    w = designW + 20;
    h = (vh - 32) / k;
    left = (vw - w * k) / 2;
    top = 16;
  }
  story.style.width = `${w}px`;
  story.style.height = `${h}px`;
  story.style.transform = `translate(${left}px, ${top}px) scale(${k})`;
  story.classList.toggle('k-framed', framed);
}

function go(target: number | string) {
  if (!story || !scenes.length) return;
  let i = typeof target === 'number' ? target : Number.NaN;
  if (typeof target === 'string') i = target.startsWith('#') ? scenes.findIndex((s) => `#${s.id}` === target) : Number(target);
  if (!Number.isFinite(i) || i < 0) return;
  const next = Math.min(scenes.length - 1, i);
  window.clearTimeout(autoTimer);
  window.clearTimeout(laterTimer);
  if (next === current) return;
  scenes[current]?.classList.remove('is-on');
  const scene = scenes[next] as HTMLElement;
  scene.classList.add('is-on');
  current = next;
  const auto = Number(scene.dataset.auto);
  if (auto > 0) autoTimer = window.setTimeout(() => current === next && go(next + 1), auto);
  scene.dispatchEvent(new CustomEvent('kit:enter', { bubbles: true, detail: { index: next } }));
  for (const fn of enterFns) fn(scene, next);
}

const next = () => go(current + 1);
const prev = () => go(Math.max(0, current - 1));

if (story && scenes.length) {
  root.classList.add('k-story-page');
  if (story.dataset.bars !== 'off') {
    scenes.forEach((scene, i) => {
      const bars = document.createElement('div');
      bars.className = 'k-bars';
      bars.setAttribute('aria-hidden', 'true');
      bars.innerHTML = scenes.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
      scene.prepend(bars);
    });
  }
  scenes.forEach((scene, i) => {
    if (!scene.hasAttribute('aria-label')) scene.setAttribute('aria-label', `${i + 1}/${scenes.length}`);
  });
  fit();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  // 첫 장면 진입 훅이 페이지 스크립트보다 먼저 돌지 않게 한 박자 늦춘다.
  const first = Math.max(0, scenes.findIndex((s) => s.classList.contains('is-on')));
  scenes[first]?.classList.remove('is-on');
  window.setTimeout(() => go(first), 0);
}

// ---------- 꽃가루 ----------

function confetti(options: ConfettiOptions = {}) {
  if (reduceMotion) return;
  const host = (options.in?.closest('.scene') as HTMLElement | null) ?? story ?? document.body;
  const layer = document.createElement('div');
  layer.className = 'k-confetti';
  layer.setAttribute('aria-hidden', 'true');
  const emoji = options.emoji?.filter(Boolean) ?? [];
  const count = options.count ?? (emoji.length ? 26 : 34);
  for (let k = 0; k < count; k++) {
    const piece = document.createElement('i');
    piece.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    piece.style.animationDuration = `${(1.4 + Math.random() * 1.2).toFixed(2)}s`;
    piece.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
    if (emoji.length) {
      piece.className = 'k-emoji';
      piece.textContent = emoji[k % emoji.length] ?? '';
    } else {
      piece.style.background = `var(--k-c${(k % 5) + 1})`;
    }
    layer.appendChild(piece);
  }
  host.appendChild(layer);
  window.setTimeout(() => layer.remove(), 3200);
}

// ---------- 도망가는 버튼 ----------

const dodgeTimers = new WeakMap<HTMLElement, number>();

function dodge(no: HTMLElement) {
  const now = Date.now();
  if (now - Number(no.dataset.kT || 0) < 280) return;
  no.dataset.kT = String(now);
  const arena = (no.closest('[data-arena]') as HTMLElement | null) ?? (no.offsetParent as HTMLElement | null);
  if (!arena) return;
  const lines = no.dataset.dodge ? no.dataset.dodge.split('|') : DEFAULT_NO;
  if (!no.dataset.kFirst) no.dataset.kFirst = no.textContent ?? '';
  const n = Number(no.dataset.kN || 0) + 1;
  no.dataset.kN = String(n);
  no.textContent = lines[Math.min(n, lines.length - 1)] ?? '';

  const grow = arena.querySelector<HTMLElement>('[data-grow]');
  const scale = Math.min(1 + n * 0.14, 1.9);
  grow?.style.setProperty('--k-grow', String(scale));

  const aw = arena.clientWidth;
  const ah = arena.clientHeight;
  const bw = no.offsetWidth;
  const bh = no.offsetHeight;
  const ox = no.offsetLeft;
  const oy = no.offsetTop;
  let x = 0;
  let y = 0;
  for (let k = 0; k < 40; k++) {
    x = Math.random() * Math.max(0, aw - bw);
    y = Math.random() * Math.max(0, ah - bh);
    let hits = false;
    if (grow) {
      const cx = grow.offsetLeft + grow.offsetWidth / 2;
      const cy = grow.offsetTop + grow.offsetHeight / 2;
      const hw = (grow.offsetWidth * scale) / 2 + 8;
      const hh = (grow.offsetHeight * scale) / 2 + 8;
      hits = x < cx + hw && x + bw > cx - hw && y < cy + hh && y + bh > cy - hh;
    }
    if (!hits && Math.hypot(x - ox, y - oy) > 60) break;
  }
  no.style.left = `${x}px`;
  no.style.top = `${y}px`;

  const scene = no.closest('.scene') ?? document;
  const hint = scene.querySelector<HTMLElement>('[data-dodge-hint]');
  if (hint && n >= 2) hint.hidden = false;

  // 몇 번 도망쳤는지는 손을 멈춘 뒤 한 번만 남긴다.
  const key = no.dataset.react;
  if (key) {
    window.clearTimeout(dodgeTimers.get(no));
    dodgeTimers.set(no, window.setTimeout(() => react(key, `${n}번 도망`), 1500));
  }
}

function resetScene(scene: ParentNode) {
  for (const no of Array.from(scene.querySelectorAll<HTMLElement>('[data-dodge]'))) {
    no.style.left = '';
    no.style.top = '';
    if (no.dataset.kFirst !== undefined) no.textContent = no.dataset.kFirst;
    delete no.dataset.kN;
  }
  for (const grow of Array.from(scene.querySelectorAll<HTMLElement>('[data-grow]'))) grow.style.removeProperty('--k-grow');
  for (const el of Array.from(scene.querySelectorAll<HTMLElement>('[data-k-shown], [data-dodge-hint]'))) {
    el.hidden = true;
    delete el.dataset.kShown;
  }
}

// ---------- LED 조회수 ----------

for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-counter]'))) {
  const digits = Number(el.dataset.counter) || 6;
  const raw = (el.textContent ?? '').trim();
  const n = /^\d+$/.test(raw) ? raw : '0';
  el.innerHTML = n
    .padStart(digits, '0')
    .split('')
    .map((d) => `<b>${d}</b>`)
    .join('');
  el.setAttribute('aria-label', `방문자 ${Number(n)}명`);
}

// ---------- 이벤트 ----------

const byIds = (list: string | undefined) =>
  (list ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => Boolean(el));

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const no = target.closest<HTMLElement>('[data-dodge]');
  if (no) {
    event.preventDefault();
    dodge(no);
    return;
  }

  const actor = target.closest<HTMLElement>('[data-next], [data-prev], [data-go], [data-show], [data-hide], [data-confetti], button[data-react], [data-reset]');
  if (actor) {
    const d = actor.dataset;
    if (d.react !== undefined && actor.tagName === 'BUTTON') react(d.react, d.value ?? actor.textContent ?? '');
    if (d.reset !== undefined) resetScene(actor.closest('.scene') ?? document);
    for (const el of byIds(d.show)) {
      el.hidden = false;
      el.dataset.kShown = '1';
    }
    for (const el of byIds(d.hide)) el.hidden = true;
    if (d.confetti !== undefined) confetti({ in: actor, emoji: d.confetti ? d.confetti.split(',').map((s) => s.trim()) : [] });
    if (d.prev !== undefined) prev();
    if (d.go !== undefined) go(d.go);
    if (d.next !== undefined) {
      const delay = Number(d.next);
      if (delay > 0) {
        const at = current;
        window.clearTimeout(laterTimer);
        laterTimer = window.setTimeout(() => current === at && next(), delay);
      } else next();
    }
    return;
  }

  if (!story || !story.contains(target) || target.closest(INTERACTIVE)) return;
  if (scenes[current]?.dataset.tap === 'off') return;
  const rect = story.getBoundingClientRect();
  if (event.clientX - rect.left < rect.width * 0.35) prev();
  else next();
});

// 터치에는 '올리기'가 없어서, 누르는 순간 도망가게 한다.
document.addEventListener('pointerdown', (event) => {
  const no = (event.target as HTMLElement).closest<HTMLElement>('[data-dodge]');
  if (no && event.pointerType !== 'mouse') {
    event.preventDefault();
    dodge(no);
  }
});
document.addEventListener('pointerover', (event) => {
  if (event.pointerType !== 'mouse') return;
  const no = (event.target as HTMLElement).closest<HTMLElement>('[data-dodge]');
  if (no) dodge(no);
});

document.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const holder = input.closest<HTMLElement>('[data-react]');
  if (!holder || holder.tagName === 'BUTTON') return;
  if (input instanceof HTMLInputElement && input.type === 'checkbox' && !input.checked) return;
  react(holder.dataset.react ?? '', input.value);
});

document.addEventListener('keydown', (event) => {
  if (!story) return;
  const t = event.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  if (event.key === ' ' && t.closest('button, a')) return;
  if (event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault();
    next();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    prev();
  }
});

// ---------- 페이지 스크립트용 ----------

const kit = {
  go,
  next,
  prev,
  get current() {
    return current;
  },
  scenes,
  confetti,
  react,
  counts,
  count,
  reset: resetScene,
  /** 장면에 들어갈 때마다 부른다. 들어간 장면과 번호를 받는다. */
  onEnter(fn: EnterFn) {
    enterFns.push(fn);
  },
};

declare global {
  interface Window {
    kit: typeof kit;
  }
}
window.kit = kit;
