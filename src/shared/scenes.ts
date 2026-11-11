// 헌정관 6장면의 HTML. 순수 함수라서 서버 렌더링과 관리자 미리보기가 같이 쓴다.
// TributeView의 문자열은 이미 이스케이프돼 있다.

import { NO_LINES } from './no-lines.ts';
import { COUPON_OPTIONS, type TributeView } from './tribute.ts';

type LevelText = readonly [string, string, string];
type LevelFn = readonly [(v: TributeView) => string, (v: TributeView) => string, (v: TributeView) => string];

// 주접 레벨별 문구 (0 = 예의 바름, 1 = 주접, 2 = 광기)
export const LEVEL_TEXT = {
  warn: [
    (v) => `안내: 본 페이지는 ${v.senior} 선배님께 감사 인사를 드리려고 만들었습니다. 끝까지 봐 주시면 영광이겠습니다.`,
    (v) => `⚠ 경고: ${v.senior} 선배님의 아우라 때문에 화면 밝기가 자동으로 올라갈 수 있습니다.`,
    (v) => `⚠ 경고 ⚠ ${v.senior} 선배님을 정면으로 보면 실명 위험이 있습니다. 반드시 선글라스를 끼고 입장하십시오.`,
  ] as LevelFn,
  enter: ['입장하기', '입장하기 ▶', '선글라스 끼고 입장 😎'] as LevelText,
  tail: ['훈훈', '술렁', '정전 사태 (너무 빛나서)'] as LevelText,
  index: ['12', '999', '∞'] as LevelText,
  extra: [
    () => '',
    (v) => ` 한편 ${v.senior} 씨는 "편하게 먹어"라는 말만 남기고 유유히 현장을 떠났다.`,
    () => ' 목격자들은 "카드를 꺼내는 순간 식당 전체에 후광이 비쳤다"고 입을 모았다.',
  ] as LevelFn,
  award: ['은혜로운 선배상', '밥약계의 빛과 소금상', '인류애 회복 공로 대상'] as LevelText,
  cert: [
    (v) => `위 사람은 ${v.dateK} ${v.place}에서 후배에게 ${v.menu}${v.menuEul} 사 주며 따뜻한 조언까지 아끼지 않았기에 이 상장을 드립니다.`,
    (v) => `위 사람은 ${v.dateK} ${v.place}에서 배고픈 후배에게 ${v.menu}${v.menuEul} 아낌없이 베풀어 후배의 위장과 마음을 동시에 채웠으므로 이 상장을 수여합니다.`,
    (v) => `위 사람은 ${v.dateK} ${v.place}에서 굶주린 후배에게 ${v.menu}${v.menuEul} 하사하여 안암의 평화와 후배의 혈당을 함께 지켜냈으므로 그 공을 길이 기리고자 이 상장을 바칩니다.`,
  ] as LevelFn,
  total: ['꼭 갚겠습니다', '평생 갚을 예정', '다음 생까지 할부'] as LevelText,
  question: ['다음에 또 같이 밥 먹어 주실 거죠?', '다음에 또 밥 사주실 거죠?', '다음 밥약, 이미 확정된 거 맞죠?'] as LevelText,
};

export { NO_LINES };

interface Scene {
  key: string;
  name: string;
  light: boolean;
  html: (v: TributeView, ctx: string) => string;
}

const lv = (v: TributeView) => (v.level - 1) as 0 | 1 | 2;
const digits = (s: string) => [...s].map((d) => `<b>${d}</b>`).join('');

export const SCENES: readonly Scene[] = [
  {
    key: 'intro',
    name: '입장',
    light: false,
    html: (v) => {
      const marquee = `★ ${v.senior} 선배님 밥약 감사합니다 ★ ${v.dateDot} ${v.place} ★ 이 은혜 잊지 않겠습니다 `;
      return `<div class="marq" aria-hidden="true"><div class="marq-track"><span>${marquee}</span><span>${marquee}</span></div></div>
<div class="sparkles" aria-hidden="true"><i style="left:8%;top:17%">✦</i><i style="left:86%;top:22%">✦</i><i style="left:12%;top:50%">✧</i><i style="left:88%;top:56%">✦</i><i style="left:48%;top:82%">✧</i></div>
<p class="wordart" style="font-size:${v.titleSize}px">${v.senior}<br>선배님</p>
<p class="tag-yellow">공식 헌정관</p>
<p class="warn">${LEVEL_TEXT.warn[lv(v)](v)}</p>
<button type="button" class="btn95" data-act="enter">${LEVEL_TEXT.enter[lv(v)]}</button>
<div class="intro-foot"><div class="counter"><span>방문자 수</span>${digits(v.views)}</div><p>Best viewed in 인스타 인앱 브라우저<br>since ${v.dateDot}</p></div>`;
    },
  },
  {
    key: 'news',
    name: '속보',
    light: true,
    html: (v) => {
      const body = `${v.dateK} ${v.place}의 한 식당에서 ${v.majorYear ? `${v.majorYear} ` : ''}${v.senior} 씨가 후배에게 ${v.menu}${v.menuEul} 사 준 사실이 확인됐다. 현장에 있던 후배 ${v.junior} 씨는 "${v.note}"라며 감격을 감추지 못했다.${LEVEL_TEXT.extra[lv(v)](v)}`;
      const photo = v.photoUrl
        ? `<div class="np-photo has-img"><img src="${v.photoUrl}" alt="밥약 현장 사진"></div>`
        : `<div class="np-photo" aria-hidden="true"><span>${v.food}</span></div>`;
      return `<header class="np-head"><span class="np-side">안암판</span><p class="np-name">밥약일보</p><span class="np-side">제1호</span></header>
<p class="np-meta"><span>${v.dateWd}</span><span>은혜지수 ▲${LEVEL_TEXT.index[lv(v)]}</span></p>
<p class="np-hl"><span class="np-flag">속보</span> ${v.yearTag}${v.senior}, 후배에게 ${v.menu} 사줘… ${v.place} 일대 ${LEVEL_TEXT.tail[lv(v)]}</p>
${photo}
<p class="np-cap">▲ 사건 현장. ${v.menu}의 생전 모습 (사진=후배 폰)</p>
<p class="np-body">${body}</p>
<p class="np-by">${v.junior} 기자 (본인)</p>
<div class="np-rank"><b>많이 본 뉴스</b><ol><li>${v.senior} 선배 "메뉴 골라" 한마디에 후배 감동</li><li>"편하게 먹어" 올해의 명대사 1위</li><li>안암 새내기들 "저도 사주세요" 문의 폭주</li></ol></div>`;
    },
  },
  {
    key: 'receipt',
    name: '은혜 영수증',
    light: false,
    html: (v) => {
      const foot = v.price ? '* 은혜는 환불·반품이 불가합니다' : '* 선배님이 겸손하셔서 금액은 비공개<br>* 은혜는 환불·반품이 불가합니다';
      return `<div class="rc-wrap"><div class="receipt">
<p class="rc-title">은혜 영수증</p><p class="rc-en">RECEIPT OF 恩惠</p>
<p class="rc-meta">밥약 은혜상회 ${v.place}점<br>${v.dateDot} · 담당 ${v.junior}</p>
<div class="rc-rule"></div>
<div class="rc-row"><span>${v.menu}</span><span>${v.price || '비공개*'}</span></div>
<div class="rc-row"><span>인생 조언 3건</span><span>측정 불가</span></div>
<div class="rc-row"><span>"편하게 먹어" 1회</span><span>∞</span></div>
<div class="rc-row"><span>선배님의 미소</span><span>priceless</span></div>
${v.level === 3 ? '<div class="rc-row"><span>선배님 존재 자체</span><span>국가 예산급</span></div>' : ''}
<div class="rc-rule"></div>
<div class="rc-row rc-total"><span>합계</span><span>${LEVEL_TEXT.total[lv(v)]}</span></div>
<div class="rc-row"><span>할부</span><span>무이자 평생</span></div>
<div class="rc-row"><span>승인번호</span><span>${v.appr}</span></div>
<div class="rc-bar" aria-hidden="true"></div>
<p class="rc-foot">${foot}</p>
<p class="rc-sign">서명<span>${v.junior}</span></p>
</div></div>
<p class="rc-note">↑ 평생 소장용</p>`;
    },
  },
  {
    key: 'cert',
    name: '상장',
    light: true,
    html: (v) => `<div class="cert">
<p class="ct-no">제 ${v.year}-001 호</p>
<p class="ct-title">상장</p>
<p class="ct-award">${LEVEL_TEXT.award[lv(v)]}</p>
<p class="ct-who"><span>${v.majorYear}</span><b>${v.senior}</b></p>
<p class="ct-body">${LEVEL_TEXT.cert[lv(v)](v)}</p>
<p class="ct-date">${v.dateY}</p>
<div class="ct-from"><p>밥약 진흥위원회<br>위원장 <b>${v.junior}</b></p><span class="seal" aria-label="은혜 인증 도장"><i>은</i><i>혜</i><i>인</i><i>증</i></span></div>
</div>`,
  },
  {
    key: 'question',
    name: '또 사주실 거죠?',
    light: false,
    html: (v) => `<p class="q-emoji" aria-hidden="true">🥺</p>
<p class="q-to">${v.senior} 선배님…</p>
<p class="q-text">${LEVEL_TEXT.question[lv(v)]}</p>
<div class="arena" data-n="0">
<button type="button" class="btn-yes" data-act="yes">네!</button>
<button type="button" class="btn-no">${NO_LINES[0]}</button>
</div>
<p class="q-hint" hidden>* '아니요' 버튼은 현재 점검 중입니다</p>
<div class="agree" hidden>
<p class="agree-stamp">녹음 완료</p>
<p class="agree-sub">법적 효력이 발생했습니다.<br>다음 밥약: 선배님 편하신 날</p>
<button type="button" class="agree-retry" data-act="retry">다시 해보기</button>
</div>
<div class="confetti" aria-hidden="true"></div>`,
  },
  {
    key: 'coupon',
    name: '보은권',
    light: true,
    html: (v, ctx) => {
      const done = `접수 완료! 이 화면 캡처해서 ${v.junior}에게 DM 주세요`;
      const chips = COUPON_OPTIONS.map(
        (o, k) =>
          `<input type="radio" id="cp-${ctx}-${k}" name="cp-${ctx}" value="${o}"${v.coupon === o ? ' checked' : ''}><label for="cp-${ctx}-${k}">${o}</label>`,
      ).join('');
      return `<p class="cp-top">2밥약 1보은 규정에 따라 발행합니다</p>
<div class="cp-wrap"><div class="ticket">
<div class="tk-head"><p>報恩券</p><span>보은권 No.${v.appr}</span></div>
<div class="tk-body">
<p class="tk-to">${v.senior} 선배님 전용</p>
<p class="tk-desc">하나 고르시면 ${v.junior}${v.juniorGa} 갚으러 갑니다</p>
<div class="chips" role="radiogroup" aria-label="보은 메뉴">${chips}</div>
<p class="tk-result" data-done="${done}">${v.coupon ? done : '↑ 하나 골라 주세요'}</p>
</div>
<div class="tk-foot"><span>유효기간: 선배님 졸업할 때까지 (자동 연장)</span><span>발행인 ${v.junior} (인)</span></div>
</div></div>
<div class="cp-bottom"><button type="button" class="cp-restart" data-act="restart">처음부터 다시 보기 ↺</button><span class="cp-count">방문자 ${v.views}</span></div>`;
    },
  },
];

export const SCENE_COUNT = SCENES.length;

const bars = (i: number) =>
  `<div class="bars" aria-hidden="true">${SCENES.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</div>`;

/** 장면 하나를 <section class="screen">으로 감싸서 돌려준다. */
export function renderScene(i: number, v: TributeView, ctx: string, active = false): string {
  const scene = SCENES[i];
  if (!scene) return '';
  const cls = `screen s-${scene.key}${scene.light ? ' light' : ''}${active ? ' is-on' : ''}`;
  return `<section class="${cls}" data-i="${i}" aria-label="${i + 1}/${SCENES.length} ${scene.name}">${bars(i)}${scene.html(v, ctx)}</section>`;
}

export function renderScenes(v: TributeView, ctx: string, activeIndex = 0): string {
  return SCENES.map((_, i) => renderScene(i, v, ctx, i === activeIndex)).join('\n');
}
