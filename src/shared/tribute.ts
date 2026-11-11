// 헌정관 한 개의 데이터 형식과 검증, 화면용 값 만들기.
// 서버(저장·렌더링)와 관리자 화면(미리보기)이 같이 쓴다.

export const LIMITS = {
  senior: 12,
  junior: 12,
  major: 16,
  menu: 30,
  place: 16,
  note: 60,
  price: 9_999_999,
} as const;

export const COUPON_OPTIONS = ['아아 한 잔', '달달한 라떼', '케이크 한 조각', '후식 풀코스'] as const;
export type CouponOption = (typeof COUPON_OPTIONS)[number];
export type Level = 1 | 2 | 3;

export interface TributeInput {
  senior: string;
  junior: string;
  major: string;
  year: string;
  menu: string;
  place: string;
  date: string; // YYYY-MM-DD
  price: number | null;
  showPrice: boolean;
  note: string;
  level: Level;
}

export interface TributeStats {
  views: number;
  agreedAt: string | null;
  coupon: CouponOption | null;
  couponAt: string | null;
}

export interface Tribute extends TributeInput {
  id: string;
  photo: string | null; // /data/photos 안의 파일 이름
  createdAt: string;
  updatedAt: string;
  stats: TributeStats;
}

export type FieldName = keyof TributeInput | 'photo';
export type FieldErrors = Partial<Record<FieldName, string>>;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const charCount = (s: string) => [...s].length;

export function isCouponOption(value: unknown): value is CouponOption {
  return typeof value === 'string' && (COUPON_OPTIONS as readonly string[]).includes(value);
}

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && y >= 2000 && y <= 2100;
}

/**
 * 폼 값을 헌정관 입력으로 바꾼다. 오류가 있어도 value는 항상 채워서 돌려준다
 * (미리보기는 오류와 상관없이 value로 그린다).
 */
export function parseTributeInput(raw: Record<string, unknown>): { value: TributeInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '').replace(CONTROL_CHARS, ' ').trim();

  const limited = (key: 'senior' | 'junior' | 'major' | 'menu' | 'place' | 'note', required: string | null) => {
    const value = text(key);
    if (!value && required) errors[key] = required;
    else if (charCount(value) > LIMITS[key]) errors[key] = `${LIMITS[key]}자까지 쓸 수 있어요.`;
    return value;
  };

  const senior = limited('senior', '선배 이름을 적어 주세요.');
  const junior = limited('junior', '내 이름을 적어 주세요.');
  const major = limited('major', null);
  const menu = limited('menu', '먹은 메뉴를 적어 주세요.');
  const place = limited('place', null);
  const note = limited('note', null);

  const year = text('year');
  if (year && !/^\d{2}$/.test(year)) errors.year = '학번은 숫자 두 자리로 적어 주세요. (예: 22)';

  const date = text('date');
  if (!isValidDate(date)) errors.date = '날짜를 골라 주세요.';

  const priceDigits = text('price').replace(/[^0-9]/g, '');
  let price: number | null = priceDigits ? Number(priceDigits) : null;
  if (price !== null && price > LIMITS.price) {
    errors.price = '금액이 너무 커요.';
    price = null;
  }

  const showRaw = raw.showPrice;
  const showPrice = showRaw === true || showRaw === 'on' || showRaw === '1' || showRaw === 'true';

  const levelNum = Number(typeof raw.level === 'number' ? raw.level : text('level'));
  let level: Level = 2;
  if (levelNum === 1 || levelNum === 2 || levelNum === 3) level = levelNum;
  else errors.level = '주접 레벨을 골라 주세요.';

  return { value: { senior, junior, major, year, menu, place, date, price, showPrice, note, level }, errors };
}

export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 받침에 맞는 조사를 고른다. 한글로 끝나지 않으면 '을(를)'처럼 둘 다 쓴다. */
export function josa(word: string, pair: '을/를' | '이/가' | '은/는' | '과/와' | '으로/로'): string {
  const [withFinal, withoutFinal] = pair.split('/') as [string, string];
  const w = word.trim();
  const code = w.charCodeAt(w.length - 1);
  if (!w || code < 0xac00 || code > 0xd7a3) return `${withFinal}(${withoutFinal})`;
  const jong = (code - 0xac00) % 28;
  if (pair === '으로/로') return jong === 0 || jong === 8 ? withoutFinal : withFinal;
  return jong ? withFinal : withoutFinal;
}

const FOOD_EMOJI: Array<[RegExp, string]> = [
  [/마라|훠궈/, '🌶️'],
  [/국밥|탕|찌개|전골/, '🍲'],
  [/삼겹|고기|갈비|족발|보쌈/, '🥩'],
  [/치킨|닭/, '🍗'],
  [/피자/, '🍕'],
  [/버거/, '🍔'],
  [/초밥|스시|회/, '🍣'],
  [/파스타|스파게티/, '🍝'],
  [/라멘|라면|우동|국수/, '🍜'],
  [/떡볶이|분식/, '🍢'],
  [/카레/, '🍛'],
  [/돈까스|돈가스|카츠/, '🍱'],
  [/샐러드|포케/, '🥗'],
  [/케이크|디저트|빙수/, '🍰'],
];
export const pickFood = (menu: string) => FOOD_EMOJI.find(([re]) => re.test(menu))?.[1] ?? '🍚';

const WEEKDAYS = '일월화수목금토';
const pad = (n: number) => String(n).padStart(2, '0');

/** 화면에 넣을 값. 문자열은 전부 HTML 이스케이프된 상태다. */
export interface TributeView {
  senior: string;
  junior: string;
  major: string;
  menu: string;
  place: string;
  note: string;
  level: Level;
  menuEul: string;
  juniorGa: string;
  majorYear: string;
  yearTag: string;
  year: number;
  dateK: string;
  dateY: string;
  dateDot: string;
  dateWd: string;
  appr: string;
  food: string;
  titleSize: number;
  price: string;
  photoUrl: string | null;
  views: string;
  coupon: CouponOption | null;
}

export interface ViewExtras {
  photoUrl: string | null;
  views: number;
  coupon: CouponOption | null;
}

export function toView(input: TributeInput, extras: ViewExtras): TributeView {
  const raw = {
    senior: input.senior.trim() || '김OO',
    junior: input.junior.trim() || '후배',
    major: input.major.trim(),
    year: /^\d{2}$/.test(input.year.trim()) ? input.year.trim() : '',
    menu: input.menu.trim() || '밥',
    place: input.place.trim() || '안암',
    note: input.note.trim() || '정말 맛있었습니다',
  };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  const d = m && isValidDate(input.date) ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const dateDot = `${y}.${pad(mo)}.${pad(day)}`;
  const majorYear = [raw.major, raw.year ? `${raw.year}학번` : ''].filter(Boolean).join(' ');
  const seniorLength = [...raw.senior].length;

  return {
    senior: escapeHtml(raw.senior),
    junior: escapeHtml(raw.junior),
    major: escapeHtml(raw.major),
    menu: escapeHtml(raw.menu),
    place: escapeHtml(raw.place),
    note: escapeHtml(raw.note),
    level: input.level,
    menuEul: josa(raw.menu, '을/를'),
    juniorGa: josa(raw.junior, '이/가'),
    majorYear: escapeHtml(majorYear),
    yearTag: raw.year ? `${raw.year}학번 ` : '',
    year: y,
    dateK: `${mo}월 ${day}일`,
    dateY: `${y}년 ${mo}월 ${day}일`,
    dateDot,
    dateWd: `${dateDot}(${WEEKDAYS[d.getDay()]})`,
    appr: `${raw.year || '26'}-${pad(mo)}${pad(day)}-0001`,
    food: pickFood(raw.menu),
    titleSize: Math.max(24, 42 - Math.max(0, seniorLength - 4) * 5),
    price: input.showPrice && input.price !== null ? `${input.price.toLocaleString('ko-KR')}원` : '',
    photoUrl: extras.photoUrl ? escapeHtml(extras.photoUrl) : null,
    views: String(Math.min(Math.max(0, Math.floor(extras.views)), 999_999)).padStart(6, '0'),
    coupon: extras.coupon,
  };
}
