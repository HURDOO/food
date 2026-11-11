// 관리 화면 동작: 링크 복사, 페이지 내리기.

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector);

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
  const target = event.target as HTMLElement;

  const copy = target.closest<HTMLElement>('[data-copy]');
  if (copy) {
    const text = copy.dataset.copy ?? '';
    // 내부망 http 주소에서는 클립보드 API가 막혀 있어서, 주소 글자를 선택해 둔다.
    const fallback = () => {
      const url = copy.closest('.a-item')?.querySelector<HTMLElement>('.a-url');
      if (url) selectText(url);
      toast('복사가 막혀 있어요. 선택된 주소를 길게 눌러 복사해 주세요.');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('복사했어요'), fallback);
    else fallback();
    return;
  }

  const item = target.closest<HTMLElement>('[data-page]');
  if (!item) return;
  const start = $<HTMLButtonElement>('[data-delete-start]', item);
  const confirm = $('[data-delete-confirm]', item);
  if (!start || !confirm) return;

  if (target.closest('[data-delete-start]')) {
    confirm.hidden = false;
    start.hidden = true;
  } else if (target.closest('[data-delete-no]')) {
    confirm.hidden = true;
    start.hidden = false;
  } else if (target.closest('[data-delete-yes]')) {
    const yes = target.closest<HTMLButtonElement>('[data-delete-yes]');
    const error = $('[data-delete-error]', item);
    if (!yes) return;
    yes.disabled = true;
    fetch(`/admin/api/pages/${encodeURIComponent(item.dataset.page ?? '')}/delete`, { method: 'POST' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        item.remove();
        toast('내렸어요');
      })
      .catch(() => {
        yes.disabled = false;
        if (error) {
          error.textContent = '내리지 못했어요. 다시 시도해 주세요.';
          error.hidden = false;
        }
      });
  }
});
