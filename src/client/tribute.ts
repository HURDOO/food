// 헌정관 페이지 동작. 빌드되면 페이지 안에 그대로 들어간다 (CSP 해시로 허용).
// 장면은 280×580 설계 크기로 그리고, 화면 크기에 맞춰 통째로 확대한다.

import { NO_LINES } from '../shared/no-lines.ts';

const DESIGN_W = 280;
const DESIGN_H = 580;

const root = document.documentElement;
root.classList.add('js');

const stage = document.getElementById('stage') as HTMLElement;
const screens = Array.from(stage.querySelectorAll<HTMLElement>('.screen'));
const id = stage.dataset.id ?? '';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let current = Math.max(0, screens.findIndex((s) => s.classList.contains('is-on')));
let advanceTimer = 0;

function fit() {
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  let k: number;
  let w: number;
  let h: number;
  let left = 0;
  let top = 0;
  const framed = vw / vh > 0.8;
  if (!framed) {
    // 폰: 화면을 꽉 채운다. 남는 쪽(대개 세로)은 설계 크기보다 길어진다.
    k = Math.min(vw / DESIGN_W, vh / DESIGN_H);
    w = vw / k;
    h = vh / k;
  } else {
    // 데스크톱·가로 화면: 가운데에 폰 모양으로 띄운다.
    k = Math.min((vh - 32) / 600, 1.6);
    w = 300;
    h = (vh - 32) / k;
    left = (vw - w * k) / 2;
    top = 16;
  }
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${k})`;
  stage.classList.toggle('framed', framed);
}

function show(i: number) {
  const next = Math.max(0, Math.min(screens.length - 1, i));
  window.clearTimeout(advanceTimer);
  if (next === current) return;
  screens[current]?.classList.remove('is-on');
  screens[next]?.classList.add('is-on');
  current = next;
}

function post(path: string, body?: unknown) {
  fetch(`/h/${encodeURIComponent(id)}/${path}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

// '아니요' 버튼은 누르려고 하면 도망간다. 위치는 확대 전 좌표(offset*)로 계산한다.
function dodge(no: HTMLElement) {
  const now = Date.now();
  if (now - Number(no.dataset.t || 0) < 280) return;
  no.dataset.t = String(now);
  const arena = no.parentElement as HTMLElement;
  const yes = arena.querySelector<HTMLElement>('.btn-yes');
  if (!yes) return;
  const n = Number(arena.dataset.n || 0) + 1;
  arena.dataset.n = String(n);
  no.textContent = NO_LINES[Math.min(n, NO_LINES.length - 1)] ?? '';
  const grow = Math.min(1 + n * 0.14, 1.9);
  yes.style.setProperty('--grow', String(grow));

  const aw = arena.clientWidth;
  const ah = arena.clientHeight;
  const bw = no.offsetWidth;
  const bh = no.offsetHeight;
  const cx = yes.offsetLeft + yes.offsetWidth / 2;
  const cy = yes.offsetTop + yes.offsetHeight / 2;
  const hw = (yes.offsetWidth * grow) / 2 + 8;
  const hh = (yes.offsetHeight * grow) / 2 + 8;
  const ox = no.offsetLeft;
  const oy = no.offsetTop;
  let x = 0;
  let y = 0;
  for (let k = 0; k < 40; k++) {
    x = Math.random() * Math.max(0, aw - bw);
    y = Math.random() * Math.max(0, ah - bh);
    const hitsYes = x < cx + hw && x + bw > cx - hw && y < cy + hh && y + bh > cy - hh;
    if (!hitsYes && Math.hypot(x - ox, y - oy) > 60) break;
  }
  no.style.left = `${x}px`;
  no.style.top = `${y}px`;
  const hint = arena.parentElement?.querySelector<HTMLElement>('.q-hint');
  if (hint && n >= 2) hint.hidden = false;
}

function confetti(box: HTMLElement | null) {
  if (reduceMotion || !box) return;
  const colors = ['var(--m-yellow)', 'var(--m-white)', 'var(--m-crimson)', 'var(--m-violet)', 'var(--m-ink)'];
  box.textContent = '';
  for (let k = 0; k < 34; k++) {
    const piece = document.createElement('i');
    piece.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    piece.style.background = colors[k % colors.length] ?? '';
    piece.style.animationDuration = `${(1.4 + Math.random() * 1.2).toFixed(2)}s`;
    piece.style.animationDelay = `${(Math.random() * 0.3).toFixed(2)}s`;
    box.appendChild(piece);
  }
  window.setTimeout(() => {
    box.textContent = '';
  }, 3000);
}

function resetQuestion(scene: HTMLElement) {
  const arena = scene.querySelector<HTMLElement>('.arena');
  const yes = scene.querySelector<HTMLElement>('.btn-yes');
  const no = scene.querySelector<HTMLElement>('.btn-no');
  const agree = scene.querySelector<HTMLElement>('.agree');
  const hint = scene.querySelector<HTMLElement>('.q-hint');
  if (arena) arena.dataset.n = '0';
  yes?.style.removeProperty('--grow');
  if (no) {
    no.style.left = '';
    no.style.top = '';
    no.textContent = NO_LINES[0] ?? '';
  }
  if (agree) agree.hidden = true;
  if (hint) hint.hidden = true;
}

const INTERACTIVE = 'button, label, input, a, .arena, .chips';

stage.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const no = target.closest<HTMLElement>('.btn-no');
  if (no) {
    event.preventDefault();
    dodge(no);
    return;
  }
  const act = target.closest<HTMLElement>('[data-act]');
  if (act) {
    const scene = act.closest<HTMLElement>('.screen');
    switch (act.dataset.act) {
      case 'enter':
        show(current + 1);
        break;
      case 'yes': {
        if (!scene) break;
        const agree = scene.querySelector<HTMLElement>('.agree');
        if (agree) agree.hidden = false;
        confetti(scene.querySelector('.confetti'));
        post('yes');
        const at = current;
        advanceTimer = window.setTimeout(() => {
          if (current === at) show(at + 1);
        }, 1900);
        break;
      }
      case 'retry':
        if (scene) resetQuestion(scene);
        break;
      case 'restart':
        show(0);
        break;
    }
    return;
  }
  if (target.closest(INTERACTIVE)) return;
  const rect = stage.getBoundingClientRect();
  show(event.clientX - rect.left < rect.width * 0.35 ? current - 1 : current + 1);
});

// 터치에는 '올리기'가 없어서, 누르는 순간 도망가게 한다.
stage.addEventListener('pointerdown', (event) => {
  const no = (event.target as HTMLElement).closest<HTMLElement>('.btn-no');
  if (no && event.pointerType !== 'mouse') {
    event.preventDefault();
    dodge(no);
  }
});
stage.addEventListener('pointerover', (event) => {
  if (event.pointerType !== 'mouse') return;
  const no = (event.target as HTMLElement).closest<HTMLElement>('.btn-no');
  if (no) dodge(no);
});

stage.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.matches('.chips input')) return;
  const result = input.closest('.tk-body')?.querySelector<HTMLElement>('.tk-result');
  if (result?.dataset.done) result.textContent = result.dataset.done;
  post('coupon', { choice: input.value });
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault();
    show(current + 1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    show(current - 1);
  }
});

fit();
window.addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);
