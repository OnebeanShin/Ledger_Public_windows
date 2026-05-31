import { api } from './api.js';
import { renderTabError, showToast } from './ui.js';
import { fmtAmount, escapeHtml, pnlClass } from './formatters.js';

const collapsedAccounts = new Set();

export async function loadAccounts() {
  let data;
  try {
    data = await api('/api/accounts');
  } catch (err) {
    renderTabError('sub-accounts', err.message);
    showToast(`계정 정보를 불러오지 못했습니다: ${err.message}`);
    return;
  }
  const balanceRows = data.balance?.rows || [];
  const balanceKRWRows = data.balance_krw?.rows || [];

  const balMap = {};
  for (const r of balanceRows) {
    balMap[r.account] = r.amounts;
  }
  const krwMap = {};
  for (const r of balanceKRWRows) {
    krwMap[r.account] = r.amounts;
  }

  const tree = buildAccountTree(data.accounts, balMap, krwMap);
  const container = document.getElementById('account-tree-container');
  container.innerHTML = renderTree(tree, 0);

  container.onclick = async e => {
    const toggle = e.target.closest('.account-toggle');
    if (toggle) {
      e.stopPropagation();
      const acct = toggle.dataset.account;
      if (!acct) return;
      if (collapsedAccounts.has(acct)) {
        collapsedAccounts.delete(acct);
      } else {
        collapsedAccounts.add(acct);
      }
      container.innerHTML = renderTree(tree, 0);
      return;
    }

    const row = e.target.closest('.account-row');
    if (!row) return;
    const acct = row.dataset.account;
    if (!acct) return;
    const panel = document.getElementById('account-detail-panel');
    panel.style.display = 'block';
    document.getElementById('account-detail-title').textContent = acct;
    const txns = await api('/api/accounts/' + encodeURIComponent(acct) + '/register');
    const tbody = document.querySelector('#account-detail-table tbody');
    tbody.innerHTML = txns.map(t => `
      <tr>
        <td>${escapeHtml(t.date)}</td>
        <td>${escapeHtml(t.description)}</td>
        <td class="right mono ${pnlClass(t.amounts[0]?.quantity)}">${fmtAmount(t.amounts)}</td>
        <td class="right mono" style="color:var(--text-secondary)">${fmtAmount(t.running_total)}</td>
      </tr>
    `).join('');
  };
}

function buildAccountTree(lines, balMap, krwMap) {
  const root = { children: {} };
  for (const line of lines) {
    const indent = line.search(/\S/);
    const name = line.trim();
    if (!name) continue;
    const fullName = findFullName(balMap, name);
    const node = { name, fullName, children: {}, indent, bal: balMap[fullName], krw: krwMap[fullName] };
    root.children[name] = root.children[name] || node;
  }

  const flat = [];
  for (const line of lines) {
    const name = line.trim();
    if (name) flat.push({ name, indent: line.search(/\S/) });
  }

  const result = [];
  const stack = [{ children: result, indent: -1 }];
  for (const item of flat) {
    const fullName = findFullName(balMap, item.name);
    const node = { name: item.name, fullName, bal: balMap[fullName], krw: krwMap[fullName], children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= item.indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push({ children: node.children, indent: item.indent });
  }
  moveEquityToEnd(result);
  return result;
}

function moveEquityToEnd(nodes) {
  for (const node of nodes) {
    moveEquityToEnd(node.children || []);
  }
  nodes.sort((a, b) => {
    const aIsEquity = (a.fullName || a.name) === 'equity';
    const bIsEquity = (b.fullName || b.name) === 'equity';
    if (aIsEquity === bIsEquity) return 0;
    return aIsEquity ? 1 : -1;
  });
}

function findFullName(balMap, shortName) {
  for (const key of Object.keys(balMap)) {
    if (key === shortName || key.endsWith(':' + shortName)) return key;
  }
  return shortName;
}

function renderTree(nodes, depth) {
  if (!nodes || nodes.length === 0) return '';
  let html = `<ul class="account-tree" style="padding-left:${depth > 0 ? 16 : 0}px">`;
  for (const node of nodes) {
    const balStr = node.bal ? fmtAmount(node.bal) : '';
    const krwStr = node.krw ? fmtAmount(node.krw) : '';
    const hasKrwBalance = (node.bal || []).some(amount => amount.commodity === 'KRW');
    const accountId = node.fullName || node.name;
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = hasChildren && collapsedAccounts.has(accountId);
    const safeAccountId = escapeHtml(accountId);
    const safeName = escapeHtml(node.name);
    html += `<li>
      <div class="account-row" data-account="${safeAccountId}">
        ${hasChildren
          ? `<button class="account-toggle" type="button" data-account="${safeAccountId}" aria-label="${isCollapsed ? '펼치기' : '접기'}" aria-expanded="${!isCollapsed}">${isCollapsed ? '▸' : '▾'}</button>`
          : '<span class="account-toggle-placeholder"></span>'}
        <span class="account-name">${safeName}</span>
        <span class="account-balance">${balStr}${krwStr && balStr && !hasKrwBalance ? ' <span style="color:var(--text-muted)">(' + krwStr + ')</span>' : ''}</span>
      </div>
      ${isCollapsed ? '' : renderTree(node.children, depth + 1)}
    </li>`;
  }
  html += '</ul>';
  return html;
}

/* ══════════════════════════════════════════════════════
   TAB 5: PORTFOLIO
   ══════════════════════════════════════════════════════ */
