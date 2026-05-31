import { api } from './api.js';
import { showToast } from './ui.js';
import { fmtAmount, fmtCumulative, escapeHtml, pnlClass } from './formatters.js';

let allTransactions = [];
let rawTransactions = [];
let transactionShowDoubleEntry = false;
let transactionTableResizeReady = false;

const CASH_ACCOUNT_PREFIXES = ['assets:bank', 'assets:cash', 'assets:savings'];
const TXN_COLUMN_STORAGE_KEY = 'ledger.txnColumnWidths.v2';
const TXN_COLUMNS = [
  { id: 'date', label: '날짜', min: 92, width: 128 },
  { id: 'description', label: '설명', min: 140, width: 260 },
  { id: 'account', label: '계정', min: 180, width: 310 },
  { id: 'amount', label: '금액', min: 120, width: 170 },
  { id: 'cumulative', label: '누적', min: 120, width: 170 },
];

function isCashLikeAccount(account) {
  return CASH_ACCOUNT_PREFIXES.some(prefix => account.startsWith(prefix));
}

function getSavedTransactionColumnWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(TXN_COLUMN_STORAGE_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return {};
    return saved;
  } catch {
    return {};
  }
}

function getTransactionColumnWidths(table) {
  const saved = getSavedTransactionColumnWidths();
  const widths = TXN_COLUMNS.map(col => Math.max(col.min, Number(saved[col.id]) || col.width));
  return fitTransactionColumnWidthsToPanel(table, widths);
}

function saveTransactionColumnWidths(widths) {
  const payload = Object.fromEntries(TXN_COLUMNS.map((col, index) => [col.id, widths[index]]));
  try {
    localStorage.setItem(TXN_COLUMN_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Column resizing is still useful even when persistent storage is unavailable.
  }
}

function applyTransactionColumnWidths(table, widths) {
  const cols = table.querySelectorAll('colgroup col');
  let totalWidth = 0;
  widths.forEach((width, index) => {
    const columnWidth = Math.max(TXN_COLUMNS[index].min, Math.round(width));
    if (cols[index]) cols[index].style.width = `${columnWidth}px`;
    totalWidth += columnWidth;
  });
  table.style.minWidth = `${totalWidth}px`;
  table.style.width = `${totalWidth}px`;
}

function getTransactionTableTargetWidth(table) {
  const panel = table.closest('.panel');
  return Math.floor(panel?.clientWidth || 0);
}

function fitTransactionColumnWidthsToPanel(table, widths) {
  const panelWidth = getTransactionTableTargetWidth(table);
  const currentWidth = widths.reduce((sum, width) => sum + width, 0);
  if (panelWidth <= currentWidth) return widths;

  const fitted = [...widths];
  const extraWidth = panelWidth - currentWidth;
  fitted[1] += Math.round(extraWidth * 0.55);
  fitted[2] += extraWidth - Math.round(extraWidth * 0.55);
  return fitted;
}

function resizeTransactionColumnPair(table, widths, index, delta) {
  const next = [...widths];
  const left = TXN_COLUMNS[index];

  if (index === TXN_COLUMNS.length - 1) {
    const currentWidth = widths.reduce((sum, width) => sum + width, 0);
    const minTotalWidth = getTransactionTableTargetWidth(table);
    const minLastWidth = Math.max(left.min, minTotalWidth - currentWidth + widths[index]);
    next[index] = Math.max(minLastWidth, widths[index] + delta);
    return next;
  }

  const rightIndex = index + 1;
  const right = TXN_COLUMNS[rightIndex];
  const minDelta = left.min - widths[index];
  const maxDelta = widths[rightIndex] - right.min;
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, delta));

  next[index] = widths[index] + clampedDelta;
  next[rightIndex] = widths[rightIndex] - clampedDelta;
  return next;
}

function ensureTransactionColgroup(table) {
  let colgroup = table.querySelector('colgroup');
  if (colgroup && colgroup.children.length === TXN_COLUMNS.length) return colgroup;

  colgroup?.remove();
  colgroup = document.createElement('colgroup');
  for (const col of TXN_COLUMNS) {
    const column = document.createElement('col');
    column.dataset.column = col.id;
    colgroup.appendChild(column);
  }
  table.insertBefore(colgroup, table.firstElementChild);
  return colgroup;
}

function wrapHeaderContent(th) {
  if (th.querySelector('.resize-header-label')) return;
  const label = document.createElement('span');
  label.className = 'resize-header-label';
  while (th.firstChild) {
    label.appendChild(th.firstChild);
  }
  th.appendChild(label);
}

function setupTransactionTableResizing() {
  if (transactionTableResizeReady) return;

  const table = document.getElementById('txn-table');
  if (!table) return;

  const headerCells = [...table.querySelectorAll('thead th')];
  if (headerCells.length !== TXN_COLUMNS.length) return;

  transactionTableResizeReady = true;
  table.classList.add('resizable-table');
  ensureTransactionColgroup(table);

  let widths = getTransactionColumnWidths(table);
  applyTransactionColumnWidths(table, widths);

  headerCells.forEach((th, index) => {
    const col = TXN_COLUMNS[index];
    th.dataset.column = col.id;
    wrapHeaderContent(th);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'column-resize-handle';
    handle.setAttribute('aria-label', `${col.label} 열 너비 조절`);
    handle.title = `${col.label} 열 너비 조절`;

    let isResizing = false;

    const setResizeState = active => {
      isResizing = active;
      table.classList.toggle('is-resizing', active);
      document.body.classList.toggle('is-column-resizing', active);
      handle.classList.toggle('active', active);
    };

    const updateColumnWidth = (clientX, startX, startWidths) => {
      widths = fitTransactionColumnWidthsToPanel(
        table,
        resizeTransactionColumnPair(table, startWidths, index, clientX - startX)
      );
      applyTransactionColumnWidths(table, widths);
    };

    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();

      const startX = e.clientX;
      const startWidths = [...widths];
      setResizeState(true);
      handle.setPointerCapture(e.pointerId);

      const onPointerMove = moveEvent => {
        updateColumnWidth(moveEvent.clientX, startX, startWidths);
      };

      const stopResizing = endEvent => {
        saveTransactionColumnWidths(widths);
        setResizeState(false);
        if (handle.hasPointerCapture(endEvent.pointerId)) {
          handle.releasePointerCapture(endEvent.pointerId);
        }
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', stopResizing);
        handle.removeEventListener('pointercancel', stopResizing);
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', stopResizing);
      handle.addEventListener('pointercancel', stopResizing);
    });

    handle.addEventListener('mousedown', e => {
      if (e.button !== 0 || isResizing) return;
      e.preventDefault();

      const startX = e.clientX;
      const startWidths = [...widths];
      setResizeState(true);

      const onMouseMove = moveEvent => {
        updateColumnWidth(moveEvent.clientX, startX, startWidths);
      };

      const stopResizing = () => {
        saveTransactionColumnWidths(widths);
        setResizeState(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', stopResizing);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', stopResizing);
    });

    handle.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      if (!touch || isResizing) return;
      e.preventDefault();

      const startX = touch.clientX;
      const startWidths = [...widths];
      setResizeState(true);

      const onTouchMove = moveEvent => {
        const currentTouch = moveEvent.touches[0];
        if (!currentTouch) return;
        moveEvent.preventDefault();
        updateColumnWidth(currentTouch.clientX, startX, startWidths);
      };

      const stopResizing = () => {
        saveTransactionColumnWidths(widths);
        setResizeState(false);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', stopResizing);
        document.removeEventListener('touchcancel', stopResizing);
      };

      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', stopResizing);
      document.addEventListener('touchcancel', stopResizing);
    }, { passive: false });

    th.appendChild(handle);
  });

  window.addEventListener('resize', () => {
    widths = fitTransactionColumnWidthsToPanel(table, widths);
    applyTransactionColumnWidths(table, widths);
  });
}

function mergePostingAmounts(postings, sign = 1) {
  const merged = new Map();
  const order = [];
  for (const posting of postings) {
    for (const amount of posting.amounts || []) {
      const commodity = amount.commodity || '';
      if (!merged.has(commodity)) {
        merged.set(commodity, 0);
        order.push(commodity);
      }
      merged.set(commodity, merged.get(commodity) + amount.quantity * sign);
    }
  }
  return order
    .map(commodity => ({ commodity, quantity: merged.get(commodity) }))
    .filter(amount => amount.quantity);
}

function pickDisplayPosting(group) {
  const expenses = group.filter(p => p.account.startsWith('expenses:'));
  if (expenses.length > 0) {
    return {
      account: expenses[0].account,
      amounts: mergePostingAmounts(expenses, -1),
    };
  }

  const income = group.filter(p => p.account.startsWith('income:'));
  if (income.length > 0) {
    return {
      account: income[0].account,
      amounts: mergePostingAmounts(income, -1),
    };
  }

  const nonCashAssets = group.filter(
    p => p.account.startsWith('assets:') && !isCashLikeAccount(p.account)
  );
  if (nonCashAssets.length > 0) {
    return {
      account: nonCashAssets[0].account,
      amounts: mergePostingAmounts(nonCashAssets),
    };
  }

  const liabilities = group.filter(p => p.account.startsWith('liabilities:'));
  if (liabilities.length > 0) {
    return {
      account: liabilities[0].account,
      amounts: mergePostingAmounts(liabilities),
    };
  }

  const cashLike = group.filter(p => isCashLikeAccount(p.account));
  if (cashLike.length > 0) {
    return {
      account: cashLike[0].account,
      amounts: mergePostingAmounts(cashLike),
    };
  }

  return {
    account: group[0].account,
    amounts: mergePostingAmounts([group[0]]),
  };
}

function consolidateTransactions(txns) {
  const result = [];
  let group = [];

  function flushGroup() {
    if (group.length === 0) return;
    const display = pickDisplayPosting(group);
    result.push({
      date: group[0].date,
      description: group[0].description,
      account: display.account,
      amounts: display.amounts,
      running_total: group[group.length - 1].running_total,
      deposit_balance: group[group.length - 1].deposit_balance,
      cumulative: group[group.length - 1].cumulative,
    });
  }

  for (const t of txns) {
    if (t.is_first && group.length > 0) {
      flushGroup();
      group = [];
    }
    group.push(t);
  }
  flushGroup();
  return result;
}

function groupTransactions(txns) {
  const groups = [];
  let group = [];
  for (const txn of txns) {
    if (txn.is_first && group.length > 0) {
      groups.push(group);
      group = [];
    }
    group.push(txn);
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

function getDisplayedTransactions() {
  if (transactionShowDoubleEntry) {
    return groupTransactions(rawTransactions).slice().reverse().flat();
  }
  return consolidateTransactions(rawTransactions).slice().reverse();
}

function refreshTransactionTable() {
  allTransactions = getDisplayedTransactions();
  renderTransactions(allTransactions);
}

export async function loadTransactions(period, account) {
  setupTransactionTableResizing();

  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (account) params.set('account', account);
  let data;
  try {
    data = await api('/api/transactions?' + params);
  } catch (err) {
    const tbody = document.querySelector('#txn-table tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-muted)">${escapeHtml(err.message)}</td></tr>`;
    showToast(`거래 내역을 불러오지 못했습니다: ${err.message}`);
    return;
  }
  rawTransactions = data;
  refreshTransactionTable();
  populateAccountFilter(data);
}

function renderTransactions(txns) {
  const search = document.getElementById('txn-search').value.toLowerCase();
  const filtered = search ? txns.filter(t =>
    t.description.toLowerCase().includes(search) || t.account.toLowerCase().includes(search)
  ) : txns;

  const tbody = document.querySelector('#txn-table tbody');
  const rawMode = transactionShowDoubleEntry;
  tbody.innerHTML = filtered.map(t => `
    <tr class="${rawMode && !t.is_first ? 'txn-continuation' : ''}">
      <td>${rawMode && !t.is_first ? '' : escapeHtml(t.date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td style="color:var(--text-secondary)">${escapeHtml(t.account)}</td>
      <td class="right mono ${pnlClass(t.amounts[0]?.quantity)}">${fmtAmount(t.amounts)}</td>
      <td class="right mono" style="color:var(--text-secondary)">${rawMode && !t.is_first ? '' : fmtCumulative(t.cumulative)}</td>
    </tr>
  `).join('');
}

function populateAccountFilter(txns) {
  const select = document.getElementById('txn-account-filter');
  if (select.options.length > 1) return;
  const accounts = [...new Set(txns.map(t => t.account))].sort();
  for (const a of accounts) {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    select.appendChild(opt);
  }
}

document.getElementById('txn-period-group').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-btn')) return;
  document.querySelectorAll('#txn-period-group .filter-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const account = document.getElementById('txn-account-filter').value;
  loadTransactions(e.target.dataset.period, account);
});

document.getElementById('txn-account-filter').addEventListener('change', e => {
  const activeBtn = document.querySelector('#txn-period-group .filter-btn.active');
  loadTransactions(activeBtn?.dataset.period, e.target.value);
});

document.getElementById('txn-search').addEventListener('input', () => renderTransactions(allTransactions));

document.getElementById('txn-double-entry-toggle').addEventListener('change', e => {
  transactionShowDoubleEntry = e.target.checked;
  refreshTransactionTable();
});

/* ══════════════════════════════════════════════════════
   TAB 3: REPORTS
   ══════════════════════════════════════════════════════ */
