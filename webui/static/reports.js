import { api } from './api.js';
import { showToast } from './ui.js';
import { fmtKRW, fmtSharePct, escapeHtml, pnlClass } from './formatters.js';
import { buildCategoryGroups, categoryTooltipLines, buildSubcategoryTransactionIndex, buildSubcategoryBreakdown, subcategoryTooltipLines } from './category-breakdown.js';
import { CHART_COLORS, doughnutOuterLabelsPlugin, getCategoryColor, isPhoneViewport } from './charts.js';

let chartExpenseBar = null, chartExpenseSubbar = null, chartExpenseDaily = null, chartExpenseYearly = null, chartExpenseTreemap = null;
const expenseAnalysisGrid = document.getElementById('expense-analysis-grid');

export async function loadReports() {
  try {
    await Promise.all([populateISPeriods(), populateExpPeriods()]);
  } catch (err) {
    showToast(`보고서 기간 목록을 불러오지 못했습니다: ${err.message}`);
  }
  loadIncomeStatement('thismonth');
  loadBalanceSheet();
  loadExpenseAnalysis('thismonth');
}

async function populateISPeriods() {
  const data = await api('/api/periods');
  const monthSel = document.getElementById('is-month-select');
  const yearSel = document.getElementById('is-year-select');
  if (monthSel.options.length > 1) return;
  for (const m of data.months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    monthSel.appendChild(opt);
  }
  for (const y of data.years) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSel.appendChild(opt);
  }
}

function reportSectionLabel(name) {
  const labels = {
    Revenues: '수입',
    Expenses: '지출',
    Assets: '자산',
    Liabilities: '부채',
  };
  return labels[name] || name;
}

function buildDailyExpenseSeries(period, byBucket) {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(period || '');
  let year = null;
  let monthIndex = null;
  let dayCount = null;

  if (monthMatch) {
    year = Number(monthMatch[1]);
    monthIndex = Number(monthMatch[2]) - 1;
    dayCount = new Date(year, monthIndex + 1, 0).getDate();
  } else if (period === 'thismonth' || period === 'lastmonth') {
    const now = new Date();
    const ref = period === 'lastmonth'
      ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    year = ref.getFullYear();
    monthIndex = ref.getMonth();
    const monthLastDay = new Date(year, monthIndex + 1, 0).getDate();
    dayCount = period === 'thismonth' ? Math.min(now.getDate(), monthLastDay) : monthLastDay;
  }

  if (year == null || monthIndex == null || dayCount == null) {
    const dates = Object.keys(byBucket).sort();
    return {
      labels: dates.map(d => String(Number(d.slice(8, 10)))),
      values: dates.map(d => byBucket[d] || 0),
    };
  }

  const month = String(monthIndex + 1).padStart(2, '0');
  const labels = [];
  const values = [];
  for (let day = 1; day <= dayCount; day += 1) {
    const dayStr = String(day).padStart(2, '0');
    const key = `${year}-${month}-${dayStr}`;
    labels.push(String(day));
    values.push(byBucket[key] || 0);
  }
  return { labels, values };
}

async function loadIncomeStatement(period) {
  let data;
  try {
    data = await api('/api/income-statement?period=' + (period || ''));
  } catch (err) {
    const el = document.getElementById('is-content');
    if (el) el.innerHTML = `<div class="tab-error"><div class="tab-error-icon">⚠</div><div class="tab-error-msg">${escapeHtml(err.message)}</div></div>`;
    showToast(`손익계산서를 불러오지 못했습니다: ${err.message}`);
    return;
  }
  const container = document.getElementById('is-content');
  let html = '';

  for (const sr of data.subreports) {
    html += `<h4 style="color:var(--text-secondary);margin:12px 0 8px;font-size:13px;">${reportSectionLabel(sr.name)}</h4>`;
    html += '<table class="data-table">';
    const groups = {};
    for (const row of sr.rows) {
      const parts = row.account.split(':');
      let baseIndex = 0;
      if ((parts[0] === 'expenses' || parts[0] === 'income') && parts.length > 1) {
        baseIndex = 1;
      }
      const base = parts[baseIndex];
      const sub = parts.slice(baseIndex + 1).join(':');
      const total = row.total.reduce((s, a) => s + (a.commodity === 'KRW' ? Math.abs(a.quantity) : 0), 0);
      
      if (!groups[base]) groups[base] = { label: base, total: 0, items: [] };
      groups[base].total += total;
      groups[base].items.push({ subLabel: sub, originalLabel: row.account, total, isBase: !sub });
    }
    const sortedGroups = Object.values(groups).sort((a, b) => b.total - a.total);
    
    for (const g of sortedGroups) {
      g.items.sort((a, b) => b.total - a.total);
      const hasSub = g.items.length > 1 || (g.items.length === 1 && !g.items[0].isBase);
      const rowId = 'is-group-' + Math.random().toString(36).substr(2, 9);
      
      html += '<tbody>';
      if (hasSub) {
        html += `<tr style="cursor:pointer;" onclick="const el=document.getElementById('${rowId}'); const icon=this.querySelector('.toggle-icon'); if(el.style.display==='none'){el.style.display='table-row-group';icon.textContent='▼';}else{el.style.display='none';icon.textContent='▶';}">
                   <td><span class="toggle-icon" style="display:inline-block;width:16px;font-size:10px;">▶</span> ${g.label}</td>
                   <td class="right mono">${fmtKRW(g.total)}</td>
                 </tr>`;
        html += `</tbody><tbody id="${rowId}" style="display:none;">`;
        for (const item of g.items) {
           const displaySub = item.isBase ? '기타' : item.subLabel;
           html += `<tr><td style="padding-left: 24px; color: var(--text-secondary);">${displaySub}</td><td class="right mono" style="color: var(--text-secondary);">${fmtKRW(item.total)}</td></tr>`;
        }
      } else {
        html += `<tr><td><span style="display:inline-block;width:16px;"></span> ${g.label}</td><td class="right mono">${fmtKRW(g.total)}</td></tr>`;
      }
      html += '</tbody>';
    }

    const srTotal = sr.totals.reduce((s, a) => s + (a.commodity === 'KRW' ? Math.abs(a.quantity) : 0), 0);
    html += `<tbody><tr style="font-weight:700;border-top:2px solid var(--border)"><td>합계</td><td class="right mono">${fmtKRW(srTotal)}</td></tr></tbody>`;
    html += '</table>';
  }

  const net = data.net.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
  html += `<div style="margin-top:16px;font-weight:700;font-size:15px;" class="${pnlClass(net)}">순이익: ${fmtKRW(net)}</div>`;
  container.innerHTML = html;

  // Removed chartExpenseBar logic, moved to Expense Analysis
}

async function loadBalanceSheet() {
  let data;
  try {
    data = await api('/api/balance-sheet');
  } catch (err) {
    const el = document.getElementById('bs-content');
    if (el) el.innerHTML = `<div class="tab-error"><div class="tab-error-icon">⚠</div><div class="tab-error-msg">${escapeHtml(err.message)}</div></div>`;
    showToast(`대차대조표를 불러오지 못했습니다: ${err.message}`);
    return;
  }
  const container = document.getElementById('bs-content');
  let html = '';
  for (const sr of data.subreports) {
    html += `<h4 style="color:var(--text-secondary);margin:12px 0 8px;font-size:13px;">${reportSectionLabel(sr.name)}</h4>`;
    html += '<table class="data-table"><tbody>';
    for (const row of sr.rows) {
      const total = row.total.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
      html += `<tr><td>${row.account}</td><td class="right mono ${pnlClass(total)}">${fmtKRW(total)}</td></tr>`;
    }
    const srTotal = sr.totals.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
    html += `<tr style="font-weight:700;border-top:2px solid var(--border)"><td>합계</td><td class="right mono ${pnlClass(srTotal)}">${fmtKRW(srTotal)}</td></tr>`;
    html += '</tbody></table>';
  }
  const net = data.net.reduce((s, a) => s + (a.commodity === 'KRW' ? a.quantity : 0), 0);
  html += `<div style="margin-top:16px;font-weight:700;font-size:15px;" class="${pnlClass(net)}">순자산: ${fmtKRW(net)}</div>`;
  container.innerHTML = html;
}

async function loadExpenseAnalysis(period) {
  period = period || 'thismonth';
  const isYearlyPeriod = /^\d{4}$/.test(period);
  const isMonthlyPeriod = /^\d{4}-\d{2}$/.test(period) || period === 'thismonth' || period === 'lastmonth';
  const trendTitle = document.getElementById('exp-trend-title');
  const yearlyTrendWrap = document.getElementById('exp-yearly-trend-wrap');
  const yearlyTrendTitle = document.getElementById('exp-yearly-trend-title');
  const detailListWrap = document.getElementById('exp-detail-list-wrap');
  const detailListTitle = document.getElementById('exp-detail-list-title');
  if (trendTitle) {
    trendTitle.textContent = isYearlyPeriod ? '월별 지출 추이' : '일별 지출 추이';
  }
  if (yearlyTrendWrap) {
    yearlyTrendWrap.style.display = 'none';
  }
  if (expenseAnalysisGrid) {
    expenseAnalysisGrid.classList.remove('expense-analysis-grid--with-yearly');
  }
  if (detailListWrap) {
    detailListWrap.style.display = 'none';
  }
  const data = await api('/api/income-statement?period=' + period);
  const expSr = data.subreports.find(s => s.name === 'Expenses');
  let transactionData = [];
  try {
    transactionData = await api('/api/transactions?period=' + period + '&account=expenses');
  } catch (e) {
    transactionData = [];
  }
  const subcategoryTransactionIndex = buildSubcategoryTransactionIndex(transactionData);

  if (chartExpenseDaily) chartExpenseDaily.destroy();
  if (chartExpenseYearly) chartExpenseYearly.destroy();
  if (chartExpenseTreemap) chartExpenseTreemap.destroy();
  if (chartExpenseSubbar) chartExpenseSubbar.destroy();
  chartExpenseDaily = null;
  chartExpenseYearly = null;
  chartExpenseTreemap = null;
  chartExpenseSubbar = null;

  const subbarWrap = document.getElementById('expense-subbar-wrap');
  if (subbarWrap) subbarWrap.style.display = 'none';

  const barPercentagePlugin = {
    id: 'barPercentage',
    afterDatasetsDraw(chart) {
      const { ctx, data } = chart;
      ctx.save();
      const meta = chart.getDatasetMeta(0);
      const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
      meta.data.forEach((bar, index) => {
        const val = data.datasets[0].data[index];
        if (total === 0 || val === 0) return;
        const pct = (val / total * 100).toFixed(1) + '%';
        ctx.font = '12px Pretendard, sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(pct, bar.x + 6, bar.y + 1);
      });
      ctx.restore();
    }
  };

  if (!expSr || expSr.rows.length === 0) {
    const barCtx = document.getElementById('chart-expense-bar');
    if (barCtx) barCtx.getContext('2d').clearRect(0, 0, 9999, 9999);
    const subbarCtx = document.getElementById('chart-expense-subbar');
    if (subbarCtx) subbarCtx.getContext('2d').clearRect(0, 0, 9999, 9999);
    const dailyCtx = document.getElementById('chart-expense-daily');
    if (dailyCtx) dailyCtx.getContext('2d').clearRect(0, 0, 9999, 9999);
    const yearlyCtx = document.getElementById('chart-expense-yearly');
    if (yearlyCtx) yearlyCtx.getContext('2d').clearRect(0, 0, 9999, 9999);
    const treemapCtx = document.getElementById('chart-expense-treemap');
    if (treemapCtx) treemapCtx.getContext('2d').clearRect(0, 0, 9999, 9999);
    return;
  }

  const groups = buildCategoryGroups(expSr.rows);
  const labels = groups.map(group => group.label);
  const values = groups.map(group => group.value);
  const expenseTotal = values.reduce((sum, value) => sum + value, 0);
  const categoryShareMap = Object.fromEntries(
    groups.map(group => [
      group.label,
      expenseTotal > 0 ? (group.value / expenseTotal) * 100 : 0,
    ])
  );

  const isPhone = isPhoneViewport();

  if (chartExpenseBar) chartExpenseBar.destroy();
  const barCtx = document.getElementById('chart-expense-bar');
  if (barCtx) {
    chartExpenseBar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: labels.map((label, idx) => getCategoryColor(label, idx)), borderRadius: 4 }]
      },
      options: {
        layout: { padding: { right: isPhone ? 12 : 40 } },
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        onClick: (e, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          const selectedGroup = groups[idx];
          if (!selectedGroup) return;

          const detailItems = buildSubcategoryBreakdown(selectedGroup, subcategoryTransactionIndex);
          if (detailItems.length === 0) {
            if (subbarWrap) subbarWrap.style.display = 'none';
            return;
          }

          if (document.getElementById('expense-subbar-title')) {
            document.getElementById('expense-subbar-title').textContent = `${selectedGroup.label} 하위 카테고리 지출`;
          }
          if (subbarWrap) {
            subbarWrap.style.display = 'block';
          }

          if (chartExpenseSubbar) chartExpenseSubbar.destroy();
          const subLabels = detailItems.map(item => item.label);
          const subValues = detailItems.map(item => item.value);
          chartExpenseSubbar = new Chart(document.getElementById('chart-expense-subbar'), {
            type: 'bar',
            data: {
              labels: subLabels,
              datasets: [{ data: subValues, backgroundColor: subLabels.map((subLabel, i) => getCategoryColor(subLabel, i)), borderRadius: 4 }]
            },
            options: {
              layout: { padding: { right: isPhone ? 12 : 40 } },
              responsive: true, maintainAspectRatio: false, indexAxis: 'y',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: ctx => `${detailItems[ctx.dataIndex].label}: ${fmtKRW(ctx.raw)}`,
                    afterLabel: ctx => subcategoryTooltipLines({ entries: detailItems[ctx.dataIndex].entries }),
                  }
                }
              },
              scales: {
                x: {
                  ticks: {
                    maxTicksLimit: isPhone ? 4 : 6,
                    font: { size: isPhone ? 10 : 12 },
                    callback: v => (v / 10000) % 1 === 0 ? (v / 10000).toFixed(0) + '만' : (v / 10000).toFixed(1) + '만'
                  }
                },
                y: { ticks: { font: { size: isPhone ? 10 : 12 } } }
              }
            },
            plugins: [barPercentagePlugin]
          });
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${groups[ctx.dataIndex].label}: ${fmtKRW(ctx.raw)}`,
              afterLabel: ctx => categoryTooltipLines(groups[ctx.dataIndex]),
            }
          }
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: isPhone ? 4 : 6,
              font: { size: isPhone ? 10 : 12 },
              callback: v => (v / 10000) % 1 === 0 ? (v / 10000).toFixed(0) + '만' : (v / 10000).toFixed(1) + '만'
            }
          },
          y: { ticks: { font: { size: isPhone ? 10 : 12 } } }
        }
      },
      plugins: [barPercentagePlugin]
    });
  }

  // Build Treemap
  const treemapData = [];
  for (const group of groups) {
    const details = buildSubcategoryBreakdown(group, subcategoryTransactionIndex);
    if (details.length === 0) {
      treemapData.push({ category: group.label, subcategory: group.label, value: group.value, entries: [] });
    } else {
      for (const detail of details) {
        treemapData.push({ category: group.label, subcategory: detail.label, value: detail.value, entries: detail.entries || [] });
      }
    }
  }

  const treemapCtx = document.getElementById('chart-expense-treemap');
  if (treemapCtx && treemapData.length > 0) {
    chartExpenseTreemap = new Chart(treemapCtx, {
      type: 'treemap',
      data: {
        datasets: [{
          tree: treemapData,
          key: 'value',
          groups: ['category', 'subcategory'],
          spacing: 1,
          borderWidth: 1,
          borderColor: '#ffffff',
          backgroundColor: (ctx) => {
            if (ctx.type !== 'data') return 'transparent';
            const raw = ctx.raw;
            let catLabel = '';
            if (raw._data && raw._data.category) {
               catLabel = raw._data.category;
            } else if (raw.children && raw.children.length > 0 && raw.children[0]._data) {
               catLabel = raw.children[0]._data.category;
            } else {
               catLabel = raw.g;
            }
            const idx = groups.findIndex(g => g.label === catLabel);
            return getCategoryColor(catLabel, Math.max(0, idx));
          },
          labels: {
            display: true,
            color: '#ffffff',
            font: (ctx) => {
              if (ctx.type !== 'data' || !ctx.raw) return { size: isPhone ? 10 : 11, family: 'Pretendard, sans-serif' };
              const w = ctx.raw.w || 0;
              const h = ctx.raw.h || 0;
              let size = Math.floor(Math.sqrt(w * h) / (isPhone ? 11 : 9));
              size = Math.max(isPhone ? 9 : 10, Math.min(size, isPhone ? 18 : 26));
              return { size, family: 'Pretendard, sans-serif' };
            },
            formatter: (ctx) => {
              if (ctx.type !== 'data' || !ctx.raw) return;
              if (ctx.raw.w < (isPhone ? 46 : 30) || ctx.raw.h < (isPhone ? 26 : 20)) return '';
              const raw = ctx.raw;
              let subcat = '';
              if (raw._data) {
                const dList = Array.isArray(raw._data) ? raw._data : [raw._data];
                for (const d of dList) {
                  if (d.subcategory) { subcat = d.subcategory; break; }
                  if (d.category) { subcat = d.category; break; }
                }
              }
              if (!subcat) subcat = raw.g;
              return subcat;
            }
          },
          captions: {
            display: true,
            color: '#ffffff',
            font: (ctx) => {
              if (ctx.type !== 'data' || !ctx.raw) {
                return { size: isPhone ? 11 : 14, weight: 'bold', family: 'Pretendard, sans-serif' };
              }
              const raw = ctx.raw;
              const category = raw.g || '';
              const share = categoryShareMap[category];
              const caption = !category
                ? ''
                : share == null
                ? category
                : `${category} (${fmtSharePct(share)})`;
              const width = raw.w || 0;
              const height = raw.h || 0;
              const widthBased = caption ? Math.floor((width - 10) / Math.max(caption.length * 0.72, 1)) : 14;
              const heightBased = Math.floor((height - 8) * 0.6);
              const size = Math.max(isPhone ? 8 : 9, Math.min(isPhone ? 11 : 14, widthBased, heightBased));
              return { size, weight: 'bold', family: 'Pretendard, sans-serif' };
            },
            padding: isPhone ? 2 : 3,
            formatter: (ctx) => {
              if (ctx.type !== 'data' || !ctx.raw) return '';
              const category = ctx.raw.g || '';
              const share = categoryShareMap[category];
              if (!category) return '';
              if ((ctx.raw.w || 0) < (isPhone ? 76 : 54) || (ctx.raw.h || 0) < (isPhone ? 22 : 16)) return '';
              if (share == null) return category;
              return `${category} (${fmtSharePct(share)})`;
            }
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item, index, array) => {
              const minArea = Math.min(...array.map(i => (i.raw.w * i.raw.h) || 0));
              return (item.raw.w * item.raw.h) === minArea;
            },
            callbacks: {
              title: (items) => {
                const raw = items[0].raw;
                let subcats = new Set();
                let cats = new Set();
                const visited = new Set();
                const search = (obj) => {
                  if (!obj || typeof obj !== 'object') return;
                  if (visited.has(obj)) return;
                  visited.add(obj);
                  if (Array.isArray(obj.entries)) {
                    if (obj.subcategory) subcats.add(obj.subcategory);
                    if (obj.category) cats.add(obj.category);
                    return;
                  }
                  for (const key in obj) {
                    if (key === 'chart' || key === 'ctx' || key === 'parent' || key === 'element') continue;
                    search(obj[key]);
                  }
                };
                search(raw);
                const catStr = Array.from(cats).join(', ');
                const subcatStr = Array.from(subcats).join(', ');
                let titleName = '';
                if (catStr && subcatStr && catStr !== subcatStr) {
                  titleName = `${catStr}:${subcatStr}`;
                } else {
                  titleName = subcatStr || catStr || raw.g || '';
                }
                return `${titleName} (총 ${fmtKRW(raw.v)})`;
              },
              label: (ctx) => {
                const raw = ctx.raw;
                let allEntries = [];
                const visited = new Set();
                const search = (obj) => {
                  if (!obj || typeof obj !== 'object') return;
                  if (visited.has(obj)) return;
                  visited.add(obj);
                  if (Array.isArray(obj.entries)) {
                    allEntries = allEntries.concat(obj.entries);
                    return;
                  }
                  for (const key in obj) {
                    if (key === 'chart' || key === 'ctx' || key === 'parent' || key === 'element') continue;
                    search(obj[key]);
                  }
                };
                search(raw);
                
                if (allEntries.length > 0) {
                  allEntries = allEntries.filter(e => e);
                  allEntries.sort((a, b) => {
                    if ((a.date || '') !== (b.date || '')) return (b.date || '').localeCompare(a.date || '');
                    return (b.amount || 0) - (a.amount || 0);
                  });
                  return subcategoryTooltipLines({ entries: allEntries });
                }
                return ["세부 내역 없음"];
              }
            }
          }
        }
      }
    });
  }

  try {
    const byBucket = {};
    for (const t of transactionData) {
      const d = t.date;
      const bucket = isYearlyPeriod ? d.slice(5, 7) : d;
      const amt = t.amounts.reduce((s, a) => s + (a.commodity === 'KRW' ? Math.abs(a.quantity) : 0), 0);
      byBucket[bucket] = (byBucket[bucket] || 0) + amt;
    }
    let labels = [];
    let values = [];
    if (isYearlyPeriod) {
      const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
      labels = months.map(m => `${Number(m)}월`);
      values = months.map(m => byBucket[m] || 0);
    } else {
      const dailySeries = buildDailyExpenseSeries(period, byBucket);
      labels = dailySeries.labels;
      values = dailySeries.values;
    }
    chartExpenseDaily = new Chart(document.getElementById('chart-expense-daily'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: '#3a3a3a', borderRadius: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              autoSkip: isYearlyPeriod,
              maxTicksLimit: isPhone ? 6 : (isYearlyPeriod ? 12 : undefined),
              maxRotation: isPhone ? 0 : (isYearlyPeriod ? 45 : 0),
              minRotation: isPhone ? 0 : (isYearlyPeriod ? 45 : 0),
              font: { size: isPhone ? 9 : 10 }
            }
          },
          y: {
            ticks: {
              maxTicksLimit: isPhone ? 4 : 6,
              font: { size: isPhone ? 9 : 10 },
              callback: v => (v / 10000) % 1 === 0 ? (v / 10000).toFixed(0) + '만' : (v / 10000).toFixed(1) + '만'
            }
          }
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtKRW(ctx.raw) } } },
      }
    });

    if (isMonthlyPeriod && !isYearlyPeriod) {
      let targetYear = null;
      if (/^\d{4}-\d{2}$/.test(period)) {
        targetYear = period.slice(0, 4);
      } else {
        const now = new Date();
        const ref = period === 'lastmonth'
          ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
          : new Date(now.getFullYear(), now.getMonth(), 1);
        targetYear = String(ref.getFullYear());
      }

      if (targetYear) {
        const yearlyData = await api('/api/transactions?period=' + targetYear + '&account=expenses');
        const byMonth = {};
        for (const t of yearlyData) {
          const month = t.date.slice(5, 7);
          const amt = t.amounts.reduce((s, a) => s + (a.commodity === 'KRW' ? Math.abs(a.quantity) : 0), 0);
          byMonth[month] = (byMonth[month] || 0) + amt;
        }
        const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
        const yearlyLabels = months.map(m => `${Number(m)}월`);
        const yearlyValues = months.map(m => byMonth[m] || 0);

        if (yearlyTrendTitle) {
          yearlyTrendTitle.textContent = `${targetYear}년 월별 지출 추이`;
        }
        if (yearlyTrendWrap) {
          yearlyTrendWrap.style.display = 'flex';
        }
        if (expenseAnalysisGrid) {
          expenseAnalysisGrid.classList.add('expense-analysis-grid--with-yearly');
        }

        chartExpenseYearly = new Chart(document.getElementById('chart-expense-yearly'), {
          type: 'bar',
          data: {
            labels: yearlyLabels,
            datasets: [{ data: yearlyValues, backgroundColor: '#3a3a3a', borderRadius: 0 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: {
                ticks: {
                  autoSkip: false,
                  maxTicksLimit: isPhone ? 6 : 12,
                  maxRotation: 0,
                  minRotation: 0,
                  font: { size: isPhone ? 9 : 10 }
                },
                grid: {
                  display: false
                }
              },
              y: {
                ticks: {
                  font: { size: isPhone ? 9 : 10 },
                  maxTicksLimit: isPhone ? 4 : 5,
                  callback: v => (v / 10000) % 1 === 0 ? (v / 10000).toFixed(0) + '만' : (v / 10000).toFixed(1) + '만'
                }
              }
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtKRW(ctx.raw) } } },
          }
        });
      }
    }
  } catch (e) { /* daily chart optional */ }
}

async function populateExpPeriods() {
  const data = await api('/api/periods');
  const monthSel = document.getElementById('exp-month-select');
  const yearSel = document.getElementById('exp-year-select');
  if (monthSel.options.length > 1) return;
  for (const m of data.months) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    monthSel.appendChild(opt);
  }
  for (const y of data.years) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearSel.appendChild(opt);
  }
}

function clearExpSelections(except) {
  if (except !== 'buttons') {
    document.querySelectorAll('#exp-period-group .filter-btn').forEach(b => b.classList.remove('active'));
  }
  if (except !== 'month') {
    document.getElementById('exp-month-select').value = '';
  }
  if (except !== 'year') {
    document.getElementById('exp-year-select').value = '';
  }
}

document.getElementById('exp-period-group').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-btn')) return;
  clearExpSelections('buttons');
  document.querySelectorAll('#exp-period-group .filter-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  loadExpenseAnalysis(e.target.dataset.period);
});

document.getElementById('exp-month-select').addEventListener('change', e => {
  if (!e.target.value) return;
  clearExpSelections('month');
  loadExpenseAnalysis(e.target.value);
});

document.getElementById('exp-year-select').addEventListener('change', e => {
  if (!e.target.value) return;
  clearExpSelections('year');
  loadExpenseAnalysis(e.target.value);
});

function clearISSelections(except) {
  if (except !== 'buttons') {
    document.querySelectorAll('#is-period-group .filter-btn').forEach(b => b.classList.remove('active'));
  }
  if (except !== 'month') {
    document.getElementById('is-month-select').value = '';
  }
  if (except !== 'year') {
    document.getElementById('is-year-select').value = '';
  }
}

document.getElementById('is-period-group').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-btn')) return;
  clearISSelections('buttons');
  document.querySelectorAll('#is-period-group .filter-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  loadIncomeStatement(e.target.dataset.period);
});

document.getElementById('is-month-select').addEventListener('change', e => {
  if (!e.target.value) return;
  clearISSelections('month');
  loadIncomeStatement(e.target.value);
});

document.getElementById('is-year-select').addEventListener('change', e => {
  if (!e.target.value) return;
  clearISSelections('year');
  loadIncomeStatement(e.target.value);
});

const expViewGroup = document.getElementById('exp-view-group');

function setExpenseAnalysisView(view) {
  const isBarView = view === 'bar';
  document.getElementById('expense-view-bar').style.display = isBarView ? 'block' : 'none';
  document.getElementById('expense-view-treemap').style.display = isBarView ? 'none' : 'flex';
  if (expenseAnalysisGrid) {
    expenseAnalysisGrid.classList.toggle('expense-analysis-grid--treemap', !isBarView);
  }
}

if (expViewGroup) {
  expViewGroup.addEventListener('click', e => {
    if (!e.target.classList.contains('filter-btn')) return;
    document.querySelectorAll('#exp-view-group .filter-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    setExpenseAnalysisView(e.target.dataset.view);
  });
}

/* ══════════════════════════════════════════════════════
   TAB 4: ACCOUNTS
   ══════════════════════════════════════════════════════ */
