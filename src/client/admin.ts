// 관리자 화면 동작: 복사 버튼, 삭제 확인, 만들기·수정 폼(사진 줄이기, 미리보기, 저장).

import { renderScenes, SCENES } from '../shared/scenes.ts';
import { parseTributeInput, toView, type FieldName, type Tribute } from '../shared/tribute.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);

// ---------- 공용: 알림과 복사 ----------

let toastTimer = 0;
function toast(message: string) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 1800);
}

function selectText(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!button) return;
  const text = button.dataset.copy ?? '';
  const fallback = () => {
    selectText(button);
    toast('복사가 막혀 있어요. 선택된 글자를 길게 눌러 복사해 주세요.');
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('복사했어요'), fallback);
  else fallback();
});

// ---------- 공유 페이지: 삭제 ----------

const deleteStart = $<HTMLButtonElement>('#delete-start');
const deleteConfirm = $('#delete-confirm');
if (deleteStart && deleteConfirm) {
  deleteStart.addEventListener('click', () => {
    deleteConfirm.hidden = false;
    deleteStart.hidden = true;
  });
  $('#delete-no')?.addEventListener('click', () => {
    deleteConfirm.hidden = true;
    deleteStart.hidden = false;
  });
  const yes = $<HTMLButtonElement>('#delete-yes');
  yes?.addEventListener('click', async () => {
    yes.disabled = true;
    const error = $('#delete-error');
    try {
      const res = await fetch(`/admin/api/tributes/${encodeURIComponent(yes.dataset.id ?? '')}/delete`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      window.location.href = '/admin';
    } catch {
      yes.disabled = false;
      if (error) {
        error.textContent = '삭제하지 못했어요. 다시 시도해 주세요.';
        error.hidden = false;
      }
    }
  });
}

// ---------- 만들기·수정 폼 ----------

const form = $<HTMLFormElement>('#tribute-form');
if (form) setupForm(form);

interface PageData {
  mode: 'new' | 'edit';
  tribute: Tribute | null;
  photoUrl: string | null;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 폰 사진을 긴 쪽 1600px JPEG로 줄인다. 다시 그리면서 위치정보 같은 메타데이터도 빠진다. */
async function shrinkPhoto(file: File): Promise<Blob> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      source = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', 0.85));
}

function setupForm(form: HTMLFormElement) {
  const dataEl = document.getElementById('page-data');
  const data = JSON.parse(dataEl?.textContent || '{}') as PageData;
  const t = data.tribute;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;

  // 처음 값 채우기
  const initial: Record<string, string> = t
    ? { senior: t.senior, junior: t.junior, major: t.major, year: t.year, menu: t.menu, place: t.place, date: t.date, price: t.price === null ? '' : String(t.price), note: t.note }
    : { date: todayLocal() };
  for (const [name, value] of Object.entries(initial)) {
    const el = field(name);
    if (el) el.value = value;
  }
  const showPrice = field('showPrice');
  if (showPrice) showPrice.checked = Boolean(t?.showPrice);
  const level = String(t?.level ?? 2);
  const levelInput = form.querySelector<HTMLInputElement>(`input[name="level"][value="${level}"]`);
  if (levelInput) levelInput.checked = true;
  if (!t) {
    // 새로 만들 때는 지난번에 쓴 내 이름을 기억해 둔다.
    try {
      const junior = localStorage.getItem('food.junior');
      const el = field('junior');
      if (junior && el && !el.value) el.value = junior;
    } catch {
      /* 저장소를 못 쓰면 그냥 넘어간다 */
    }
  }

  // 사진
  const photoInput = $<HTMLInputElement>('#f-photo');
  const photoPreview = $<HTMLImageElement>('#photo-preview');
  const photoPick = $('#photo-pick');
  const photoChange = $<HTMLButtonElement>('#photo-change');
  const photoRemove = $<HTMLButtonElement>('#photo-remove');
  let photoBlob: Blob | null = null;
  let photoObjectUrl: string | null = null;
  let previewPhotoUrl: string | null = data.photoUrl;
  let removePhoto = false;

  const renderPhoto = () => {
    const url = photoObjectUrl ?? (removePhoto ? null : data.photoUrl);
    previewPhotoUrl = url;
    if (photoPreview && photoPick) {
      photoPreview.hidden = !url;
      if (url) photoPreview.src = url;
      photoPick.hidden = Boolean(url);
    }
    if (photoChange) photoChange.hidden = !url;
    if (photoRemove) photoRemove.hidden = !url;
    renderPreview();
  };

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    showError('photo', '');
    try {
      photoBlob = await shrinkPhoto(file);
      if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
      photoObjectUrl = URL.createObjectURL(photoBlob);
      removePhoto = false;
    } catch {
      photoBlob = null;
      showError('photo', '이 사진은 열 수 없어요. JPG나 PNG 사진으로 골라 주세요.');
    }
    photoInput.value = '';
    renderPhoto();
  });
  photoChange?.addEventListener('click', () => photoInput?.click());
  photoRemove?.addEventListener('click', () => {
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = null;
    photoBlob = null;
    removePhoto = true;
    renderPhoto();
  });

  // 미리보기
  const tabs = $('#pv-tabs');
  const phone = $('#pv-phone');
  const frame = $('#pv-frame');
  let active = 0;

  const formValues = () => {
    const fd = new FormData(form);
    const raw: Record<string, unknown> = {};
    fd.forEach((value, key) => {
      if (typeof value === 'string') raw[key] = value;
    });
    return raw;
  };

  function renderPreview() {
    if (!phone) return;
    const { value } = parseTributeInput(formValues());
    const view = toView(value, { photoUrl: previewPhotoUrl, views: t?.stats.views ?? 0, coupon: null });
    phone.innerHTML = renderScenes(view, 'pv', active);
  }

  if (tabs) {
    tabs.innerHTML = SCENES.map(
      (scene, i) => `<button type="button" role="tab" class="a-tab" data-i="${i}" aria-selected="${i === 0}" title="${scene.name}">${i + 1}<span>${scene.name}</span></button>`,
    ).join('');
    tabs.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!tab) return;
      active = Number(tab.dataset.i);
      tabs.querySelectorAll('[data-i]').forEach((el) => el.setAttribute('aria-selected', String(el === tab)));
      renderPreview();
    });
  }

  const fitPreview = () => {
    if (!frame || !phone) return;
    const k = Math.min(1, frame.clientWidth / 294);
    phone.style.transform = `scale(${k})`;
    frame.style.height = `${594 * k}px`;
  };
  window.addEventListener('resize', fitPreview);
  fitPreview();

  form.addEventListener('input', renderPreview);
  form.addEventListener('change', renderPreview);
  renderPhoto();

  // 오류 표시
  function showError(name: FieldName | string, message: string) {
    const el = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  // 저장
  const submit = $<HTMLButtonElement>('#submit');
  const formError = $('#form-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => {
      el.hidden = true;
    });
    if (formError) formError.hidden = true;

    const raw = formValues();
    const { errors } = parseTributeInput(raw);
    const names = Object.keys(errors) as FieldName[];
    if (names.length) {
      for (const name of names) showError(name, errors[name] ?? '');
      form.querySelector<HTMLElement>(`[data-field="${names[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const fd = new FormData(form);
    fd.delete('photo');
    if (photoBlob) fd.set('photo', photoBlob, 'photo.jpg');
    if (removePhoto) fd.set('removePhoto', '1');
    if (submit) submit.disabled = true;
    try {
      const url = data.mode === 'edit' && t ? `/admin/api/tributes/${encodeURIComponent(t.id)}` : '/admin/api/tributes';
      const res = await fetch(url, { method: 'POST', body: fd });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; errors?: Record<string, string> };
      if (!res.ok || !body.id) {
        if (body.errors) for (const [name, message] of Object.entries(body.errors)) showError(name, message);
        else throw new Error(String(res.status));
        return;
      }
      try {
        localStorage.setItem('food.junior', String(raw.junior ?? ''));
      } catch {
        /* 무시 */
      }
      window.location.href = `/admin/t/${encodeURIComponent(body.id)}${data.mode === 'new' ? '?new=1' : ''}`;
    } catch {
      if (formError) {
        formError.textContent = '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.';
        formError.hidden = false;
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}
