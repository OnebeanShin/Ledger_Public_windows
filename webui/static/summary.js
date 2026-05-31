import { api } from './api.js';
import { renderTabError, showToast } from './ui.js';
import { fmtKRW, fmtKRWCompact, fmtPct, fmtAmount, escapeHtml, pnlClass } from './formatters.js';
import { buildCategoryGroups, categoryTooltipLines } from './category-breakdown.js';
import { ASSET_COLOR_MAP, CHART_COLORS, doughnutOuterLabelsPlugin, isPhoneViewport } from './charts.js';

let chartAssetAlloc = null;

export async function loadSummary() {
  let data;
  try {
    data = await api('/api/summary');
  } catch (err) {
    renderTabError('tab-summary', err.message);
    showToast(`요약 데이터를 불러오지 못했습니다: ${err.message}`);
    return;
  }
  const bs = data.balance_sheet;
  const is = data.income_statement;
  const portfolio = data.portfolio_summary;

  let totalAssets = 0, totalLiabilities = 0;
  for (const sr of bs.subreports) {
    const total = sr.totals.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
    if (sr.name === 'Assets') totalAssets = total;
    if (sr.name === 'Liabilities') totalLiabilities = total;
  }
  const netWorth = bs.net.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
  const depositBalance = data.deposit_balance || 0;
  const depositChange = data.deposit_balance_change || 0;
  const depositCompareBasis = data.deposit_compare_basis;
  const depositCompareLabel = depositChange > 0
    ? `${depositCompareBasis === 'month_end' ? '전월 말' : '전월 동기'} 대비 ${fmtKRW(depositChange)} 증가`
    : depositChange < 0
    ? `${depositCompareBasis === 'month_end' ? '전월 말' : '전월 동기'} 대비 ${fmtKRW(Math.abs(depositChange))} 감소`
    : `${depositCompareBasis === 'month_end' ? '전월 말' : '전월 동기'}와 동일`;

  let totalRevenue = 0, totalExpenses = 0;
  for (const sr of is.subreports) {
    const total = sr.totals.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
    if (sr.name === 'Revenues') totalRevenue = Math.abs(total);
    if (sr.name === 'Expenses') totalExpenses = total;
  }

  const periodExpenseDiff = totalExpenses - (data.previous_period_expenses || 0);
  const periodExpenseDiffLabel = periodExpenseDiff > 0
    ? `전월 동기 대비 ${fmtKRW(periodExpenseDiff)} 더 지출`
    : periodExpenseDiff < 0
    ? `전월 동기 대비 ${fmtKRW(Math.abs(periodExpenseDiff))} 덜 지출`
    : '전월 동기와 동일';

  const cardsEl = document.getElementById('summary-cards');
  cardsEl.innerHTML = `
    <div class="card">
      <div class="card-label">예금 잔액</div>
      <div class="card-value">${fmtKRW(depositBalance)}</div>
      <div class="card-sub ${depositChange > 0 ? 'positive' : depositChange < 0 ? 'negative' : 'neutral'}">${depositCompareLabel}</div>
    </div>
    <div class="card">
      <div class="card-label">이달 수입</div>
      <div class="card-value positive">${fmtKRW(totalRevenue)}</div>
    </div>
    <div class="card">
      <div class="card-label">이달 지출</div>
      <div class="card-value negative">${fmtKRW(totalExpenses)}</div>
      <div class="card-sub ${periodExpenseDiff > 0 ? 'negative' : periodExpenseDiff < 0 ? 'positive' : 'neutral'}">${periodExpenseDiffLabel}</div>
    </div>
    <div class="card">
      <div class="card-label">투자 수익률</div>
      <div class="card-value ${pnlClass(portfolio.total_return_pct)}">${fmtPct(portfolio.total_return_pct)}</div>
      <div class="card-sub ${pnlClass(portfolio.total_pnl_krw)}">${fmtKRWCompact(portfolio.total_pnl_krw)}</div>
    </div>
  `;

  const summaryAssetTotalEl = document.getElementById('summary-asset-total-inline');
  if (summaryAssetTotalEl) {
    summaryAssetTotalEl.textContent = `총 자산 ${fmtKRW(totalAssets)}`;
    summaryAssetTotalEl.className = 'panel-title-side neutral';
  }

  const cashValue = data.cash_balance || 0;
  const holdings = data.portfolio_holdings || [];

  const labels = ['현금'];
  const values = [Math.max(0, cashValue)];
  const colors = [ASSET_COLOR_MAP['현금']];
  holdings.forEach((h, i) => {
    labels.push(h.symbol);
    values.push(Math.max(0, h.market_total_krw));
    colors.push(ASSET_COLOR_MAP[h.symbol] || CHART_COLORS[i % CHART_COLORS.length]);
  });

  const isPhone = isPhoneViewport();

  if (chartAssetAlloc) chartAssetAlloc.destroy();
  chartAssetAlloc = new Chart(document.getElementById('chart-asset-alloc'), {
    type: 'doughnut',
    plugins: [doughnutOuterLabelsPlugin],
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: isPhone
          ? { top: 8, right: 8, bottom: 8, left: 8 }
          : { top: 24, right: 72, bottom: 24, left: 72 }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtKRW(ctx.raw) } },
        doughnutOuterLabels: {
          display: !isPhone,
          color: '#4a4a4a',
          lineColor: '#c9c7bf',
          fontSize: isPhone ? 10 : 12,
          formatter: ({ label, percentage }) => `${label} (${percentage.toFixed(1)}%)`,
        },
      }
    }
  });

  const assetTotal = values.reduce((s, v) => s + v, 0);
  document.getElementById('asset-alloc-legend').innerHTML = labels.map((label, i) => {
    const val = values[i];
    const pct = assetTotal > 0 ? (val / assetTotal * 100).toFixed(1) : '0.0';
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span class="legend-name">${escapeHtml(label)}</span>
      <span class="legend-value">${fmtKRW(val)}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join('');

  const debtAbs = Math.abs(totalLiabilities);
  const debtRatio = totalAssets > 0 ? (debtAbs / totalAssets * 100) : 0;
  document.getElementById('summary-liability-strip').innerHTML = `
    <div class="summary-liability-card">
      <div class="summary-liability-label">부채</div>
      <div class="summary-liability-value negative">-${fmtKRW(debtAbs)}</div>
    </div>
    <div class="summary-liability-card">
      <div class="summary-liability-label">부채비율</div>
      <div class="summary-liability-value negative">${debtRatio.toFixed(1)}%</div>
    </div>
    <div class="summary-liability-card">
      <div class="summary-liability-label">순자산</div>
      <div class="summary-liability-value ${pnlClass(netWorth)}">${fmtKRW(netWorth)}</div>
    </div>
  `;

  const currentMonth = new Date().getMonth() + 1;
  document.getElementById('summary-revenue-title').textContent = currentMonth + '월 수입 내역';
  document.getElementById('summary-expense-title').textContent = currentMonth + '월 지출 내역';
  renderBreakdown(is, 'Revenues', 'summary-revenue-breakdown', '#22c55e');
  renderBreakdown(is, 'Expenses', 'summary-expense-breakdown', '#ef4444');

  const tbody = document.querySelector('#recent-txns tbody');
  tbody.innerHTML = data.recent_transactions.map(t => `
    <tr>
      <td>${escapeHtml(t.date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td style="color:var(--text-secondary)">${escapeHtml(t.account)}</td>
      <td class="right mono ${pnlClass(t.amounts[0]?.quantity)}">${fmtAmount(t.amounts)}</td>
    </tr>
  `).join('');

  document.getElementById('header-meta').textContent = new Date().toLocaleString('ko-KR');
}

const BREAKDOWN_COLORS = ['#4a8ab5', '#c47a2a', '#5a9a44', '#c45050', '#8a5aa0', '#2a8a7a', '#b07030', '#3a78b5', '#7a9a3a', '#a05a7a'];

function renderBreakdown(isData, subreportName, containerId, barColor) {
  const container = document.getElementById(containerId);
  const sr = isData.subreports.find(s => s.name === subreportName);
  if (!sr || sr.rows.length === 0) {
    container.innerHTML = '<div class="breakdown-empty">데이터 없음</div>';
    return;
  }

  const items = buildCategoryGroups(sr.rows);

  const total = items.reduce((s, i) => s + i.value, 0);

  container.innerHTML = items.map((item, idx) => {
    const pct = total > 0 ? (item.value / total * 100) : 0;
    const color = BREAKDOWN_COLORS[idx % BREAKDOWN_COLORS.length];
    const tooltip = escapeHtml(categoryTooltipLines(item).join('\n'));
    return `
      <div class="breakdown-item" title="${tooltip}">
        <div class="breakdown-header">
          <span class="breakdown-label">${item.label}</span>
          <span><span class="breakdown-value">${fmtKRW(item.value)}</span><span class="breakdown-pct">${pct.toFixed(1)}%</span></span>
        </div>
        <div class="breakdown-bar-bg">
          <div class="breakdown-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');
}
