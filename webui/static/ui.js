import { escapeHtml } from './formatters.js';

/* ── Toast notifications ─────────────────────────────── */

/**
 * 화면 하단에 토스트 알림을 표시한다.
 * @param {string} message  - 본문 메시지
 * @param {'error'|'warn'|'info'} [type='error'] - 알림 종류
 * @param {number} [duration=5000] - 자동 닫힘 시간(ms)
 */
export function showToast(message, type = 'error', duration = 5000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { error: '⚠', warn: '!', info: 'ℹ' };
  const titles = { error: '오류', warn: '경고', info: '알림' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] ?? '!'}</span>
    <div class="toast-body">
      <div class="toast-title">${titles[type] ?? type}</div>
      <div class="toast-msg">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

/**
 * 탭 콘텐츠 영역에 에러 패널을 렌더링한다.
 * @param {string} tabId     - 예: 'tab-summary'
 * @param {string} message   - 에러 메시지
 */
export function renderTabError(tabId, message) {
  const el = document.getElementById(tabId);
  if (!el) return;
  el.innerHTML = `
    <div class="tab-error">
      <div class="tab-error-icon">⚠</div>
      <div class="tab-error-title">데이터를 불러오지 못했습니다</div>
      <div class="tab-error-msg">${escapeHtml(message)}</div>
    </div>
  `;
}
