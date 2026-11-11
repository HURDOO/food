import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderScenes, SCENE_COUNT } from '../src/shared/scenes.ts';
import { josa, parseTributeInput, pickFood, toView, type TributeInput } from '../src/shared/tribute.ts';

const sample: TributeInput = {
  senior: '김호랑',
  junior: '이새내',
  major: '경영학과',
  year: '22',
  menu: '마라탕이랑 꿔바로우',
  place: '참살이길',
  date: '2026-11-10',
  price: 38000,
  showPrice: false,
  note: '배도 마음도 꽉 찼습니다',
  level: 2,
};

test('josa picks the particle from the final consonant', () => {
  assert.equal(josa('꿔바로우', '을/를'), '를');
  assert.equal(josa('마라탕', '을/를'), '을');
  assert.equal(josa('이새내', '이/가'), '가');
  assert.equal(josa('김민준', '이/가'), '이');
  assert.equal(josa('서울', '으로/로'), '로');
  assert.equal(josa('학교', '으로/로'), '로');
  assert.equal(josa('식당', '으로/로'), '으로');
  assert.equal(josa('Pizza', '을/를'), '을(를)');
});

test('parseTributeInput accepts a complete form', () => {
  const { value, errors } = parseTributeInput({ ...sample, price: '38,000원', level: '3', showPrice: 'on' });
  assert.deepEqual(errors, {});
  assert.equal(value.price, 38000);
  assert.equal(value.level, 3);
  assert.equal(value.showPrice, true);
});

test('parseTributeInput reports missing and invalid fields', () => {
  const { errors } = parseTributeInput({ senior: '', junior: '나', menu: '', year: '2022', date: '2026-02-30', level: '9' });
  assert.ok(errors.senior);
  assert.ok(errors.menu);
  assert.ok(errors.year);
  assert.ok(errors.date);
  assert.ok(errors.level);
  assert.equal(errors.junior, undefined);
});

test('parseTributeInput enforces length limits and strips control characters', () => {
  const { value, errors } = parseTributeInput({ ...sample, senior: '가'.repeat(13), note: 'a\nb\u0007c' });
  assert.ok(errors.senior);
  assert.equal(value.note, 'a b c');
});

test('pickFood maps menus to a fitting emoji', () => {
  assert.equal(pickFood('마라탕'), '🌶️');
  assert.equal(pickFood('순대국밥'), '🍲');
  assert.equal(pickFood('오므라이스'), '🍚');
});

test('toView hides the price unless it is shown and pads the visitor count', () => {
  const hidden = toView(sample, { photoUrl: null, views: 42, coupon: null });
  assert.equal(hidden.price, '');
  assert.equal(hidden.views, '000042');
  const shown = toView({ ...sample, showPrice: true }, { photoUrl: null, views: 0, coupon: null });
  assert.equal(shown.price, '38,000원');
});

test('renderScenes draws six scenes with the tribute details', () => {
  const html = renderScenes(toView(sample, { photoUrl: null, views: 7, coupon: null }), 'live');
  assert.equal(html.match(/<section class="screen/g)?.length, SCENE_COUNT);
  assert.equal(SCENE_COUNT, 6);
  assert.match(html, /김호랑<br>선배님/);
  assert.match(html, /마라탕이랑 꿔바로우를 사 준/);
  assert.match(html, /이새내가 갚으러 갑니다/);
  assert.match(html, /밥약계의 빛과 소금상/);
  assert.match(html, /비공개\*/);
  assert.match(html, /<b>0<\/b><b>0<\/b><b>0<\/b><b>0<\/b><b>0<\/b><b>7<\/b>/);
});

test('renderScenes escapes user input', () => {
  const evil = { ...sample, senior: '<img src=x onerror=alert(1)>', note: '"><script>alert(1)</script>' };
  const html = renderScenes(toView(evil, { photoUrl: null, views: 0, coupon: null }), 'live');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderScenes uses the photo when present and marks the chosen coupon', () => {
  const html = renderScenes(toView(sample, { photoUrl: '/p/AbcdEfgh12-xYz123.jpg', views: 0, coupon: '달달한 라떼' }), 'live');
  assert.match(html, /<img src="\/p\/AbcdEfgh12-xYz123\.jpg" alt="밥약 현장 사진">/);
  assert.match(html, /value="달달한 라떼" checked/);
  assert.match(html, /접수 완료!/);
});
