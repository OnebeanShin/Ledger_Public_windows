import { api } from './api.js';
import { renderTabError, showToast } from './ui.js';
import { fmtKRW, fmtKRWCompact, fmtUSD, fmtQty, fmtPct, fmtDateTime, pnlClass } from './formatters.js';
import { ASSET_COLOR_MAP, CHART_COLORS, doughnutOuterLabelsPlugin, isPhoneViewport } from './charts.js';

let chartPortfolioAlloc = null, chartPriceHistory = null;
let portfolioData = null;

function clearChartCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function rebuildPriceChartOptions(holdings, pricesHistory, totalMarketHistory, selectedSymbol) {
  const select = document.getElementById('price-chart-symbol');
  if (!select) return '';

  const options = [];
  const seen = new Set();
  const pushOption = (value, label) => {
    if (seen.has(value)) return;
    seen.add(value);
    options.push({ value, label });
  };

  if ((totalMarketHistory || []).length > 0) {
    pushOption('TOTAL', '전체평가액');
  }
  holdings.forEach(item => pushOption(item.symbol, item.symbol));
  if ((pricesHistory.USD || []).length > 0) {
    pushOption('USD', 'USD/KRW');
  }

  select.innerHTML = options.map(option => (
    `<option value="${option.value}">${option.label}</option>`
  )).join('');
  select.disabled = options.length === 0;

  if (seen.has(selectedSymbol)) return selectedSymbol;
  return options[0]?.value || '';
}

export async function loadPortfolio() {
  try {
    portfolioData = await api('/api/portfolio');
  } catch (err) {
    renderTabError('tab-portfolio', err.message);
    showToast(`투자 정보를 불러오지 못했습니다: ${err.message}`);
    return;
  }
  const s = portfolioData.summary;
  const h = portfolioData.holdings || [];
  const ex = portfolioData.exchange_rate;
  const priceChartSymbolSelect = document.getElementById('price-chart-symbol');
  const selectedSymbol = priceChartSymbolSelect?.value || 'TOTAL';

  const elTotalInline = document.getElementById('portfolio-alloc-total-inline');
  if (elTotalInline) {
    elTotalInline.textContent = fmtKRW(s.total_market_krw);
  }

  document.getElementById('portfolio-cards').innerHTML = `
    <div class="card">
      <div class="card-label">총 투자원금</div>
      <div class="card-value">${fmtKRW(s.total_cost_krw)}</div>
    </div>
    <div class="card">
      <div class="card-label">현재 평가액</div>
      <div class="card-value">${fmtKRW(s.total_market_krw)}</div>
    </div>
    <div class="card">
      <div class="card-label">총 수익/손실</div>
      <div class="card-value ${pnlClass(s.total_pnl_krw)}">${fmtKRWCompact(s.total_pnl_krw)}</div>
    </div>
    <div class="card">
      <div class="card-label">수익률</div>
      <div class="card-value ${pnlClass(s.total_return_pct)}">${fmtPct(s.total_return_pct)}</div>
      <div class="card-sub neutral">환율 ${ex.usd_krw.toLocaleString('ko-KR')} ₩/$ (${ex.date})</div>
    </div>
  `;

  const tbody = document.querySelector('#holdings-table tbody');
  tbody.innerHTML = h.map(item => `
    <tr>
      <td><strong>${item.symbol}</strong> <span style="color:var(--text-muted);font-size:11px;">${item.label}</span></td>
      <td class="right mono">${fmtQty(item.quantity, item.symbol)}</td>
      <td class="right mono">${fmtUSD(item.cost_per_unit_usd)}</td>
      <td class="right mono">${fmtUSD(item.current_price_usd)}</td>
      <td class="right mono">${fmtKRW(item.cost_total_krw)}</td>
      <td class="right mono">${fmtKRW(item.market_total_krw)}</td>
      <td class="right mono ${pnlClass(item.pnl_krw)}">${fmtKRWCompact(item.pnl_krw)}</td>
      <td class="right"><span class="badge ${item.return_pct >= 0 ? 'badge-green' : 'badge-red'}">${fmtPct(item.return_pct)}</span></td>
    </tr>
  `).join('');

  const cashVal = portfolioData.cash_balance || 0;
  const labels = [];
  const values = [];
  const colors = [];

  if (cashVal > 0) {
    labels.push('현금');
    values.push(cashVal);
    colors.push(ASSET_COLOR_MAP['현금'] || CHART_COLORS[0]);
  }
  h.forEach((item, index) => {
    labels.push(item.symbol);
    values.push(Math.max(0, item.market_total_krw));
    colors.push(ASSET_COLOR_MAP[item.symbol] || CHART_COLORS[(index + (cashVal > 0 ? 1 : 0)) % CHART_COLORS.length]);
  });

  const isPhone = isPhoneViewport();

  if (chartPortfolioAlloc) chartPortfolioAlloc.destroy();
  chartPortfolioAlloc = new Chart(document.getElementById('chart-portfolio-alloc'), {
    type: 'doughnut',
    plugins: [doughnutOuterLabelsPlugin],
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
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
      },
      onClick: (_, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const nextSymbol = labels[idx];
        const chartSymbol = nextSymbol === '현금' ? 'USD' : nextSymbol;
        if (priceChartSymbolSelect) {
          priceChartSymbolSelect.value = chartSymbol;
        }
        renderPriceChart(chartSymbol);
      },
    }
  });

  const pricesHistory = portfolioData.prices_history || {};
  const totalMarketHistory = portfolioData.total_market_history || [];
  const chartSymbol = rebuildPriceChartOptions(
    h,
    pricesHistory,
    totalMarketHistory,
    selectedSymbol,
  );
  if (priceChartSymbolSelect) {
    priceChartSymbolSelect.value = chartSymbol;
  }
  renderPriceChart(chartSymbol);

  const priceGrid = document.getElementById('price-grid');
  const latestPriceSymbols = [];
  const seenLatestSymbols = new Set();
  const pushLatestSymbol = sym => {
    if (seenLatestSymbols.has(sym)) return;
    seenLatestSymbols.add(sym);
    latestPriceSymbols.push(sym);
  };
  h.forEach(item => pushLatestSymbol(item.symbol));
  if ((pricesHistory.USD || []).length > 0) {
    pushLatestSymbol('USD');
  }

  const updatedAtEl = document.getElementById('price-updated-at');
  if (updatedAtEl) {
    updatedAtEl.textContent = portfolioData.prices_file_mtime
      ? `최신 업데이트: ${fmtDateTime(portfolioData.prices_file_mtime)}`
      : '';
  }

  const latestPricesMarkup = latestPriceSymbols.map(sym => {
    const entries = pricesHistory[sym] || [];
    if (entries.length === 0) return '';
    const p = entries[entries.length - 1];
    return `
    <div class="price-item">
      <div class="price-symbol">${sym === 'USD' ? 'USD/KRW' : sym}</div>
      <div class="price-value">${sym === 'USD' ? '₩' + p.price.toLocaleString('ko-KR', {maximumFractionDigits: 2}) : fmtUSD(p.price)}</div>
      <div class="price-date">${p.date}</div>
    </div>
  `;
  }).join('');
  priceGrid.innerHTML = latestPricesMarkup || '<div class="breakdown-empty">표시할 시세 없음</div>';
}

function renderPriceChart(symbol) {
  if (!portfolioData) return;
  const isPhone = isPhoneViewport();
  const isTotal = symbol === 'TOTAL';
  const entries = isTotal
    ? (portfolioData.total_market_history || [])
    : (portfolioData.prices_history[symbol] || []);
  if (chartPriceHistory) {
    chartPriceHistory.destroy();
    chartPriceHistory = null;
  }
  if (!symbol || entries.length === 0) {
    clearChartCanvas('chart-price-history');
    return;
  }
  const isKRW = isTotal || symbol === 'USD';
  const label = isTotal
    ? '전체평가액 (KRW)'
    : (symbol === 'USD' ? 'USD/KRW' : symbol + ' (USD)');
  chartPriceHistory = new Chart(document.getElementById('chart-price-history'), {
    type: 'line',
    data: {
      labels: entries.map(e => e.date.slice(5)),
      datasets: [{
        label,
        data: entries.map(e => isTotal ? e.value : e.price),
        borderColor: '#5b7a94',
        backgroundColor: 'rgba(91, 122, 148, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: isPhone ? 2 : 3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: isPhone ? 5 : 8,
            font: { size: isPhone ? 10 : 12 },
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            maxTicksLimit: isPhone ? 4 : 6,
            font: { size: isPhone ? 10 : 12 },
            callback: v => isKRW ? '₩' + v.toLocaleString('ko-KR') : '$' + v.toLocaleString('en-US')
          }
        }
      }
    }
  });
}

document.getElementById('price-chart-symbol').addEventListener('change', e => {
  renderPriceChart(e.target.value);
});

document.getElementById('btn-update-prices').addEventListener('click', async () => {
  const btn = document.getElementById('btn-update-prices');
  btn.disabled = true;
  btn.textContent = '갱신 중...';
  try {
    const resp = await fetch('/api/prices/update', { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
      btn.textContent = '완료!';
      setTimeout(() => { btn.textContent = '시세 갱신'; btn.disabled = false; }, 2000);
      await loadPortfolio();
    } else {
      btn.textContent = '실패';
      setTimeout(() => { btn.textContent = '시세 갱신'; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = '오류';
    setTimeout(() => { btn.textContent = '시세 갱신'; btn.disabled = false; }, 2000);
  }
});
