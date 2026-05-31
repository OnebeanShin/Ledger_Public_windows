/* ── Formatters ──────────────────────────────────────── */

export function fmtKRW(n) {
  if (n == null) return '-';
  const abs = Math.abs(Math.round(n));
  const s = abs.toLocaleString('ko-KR');
  return (n < 0 ? '-' : '') + '₩' + s;
}

export function fmtKRWCompact(n) {
  if (n == null) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 1e8) return sign + '₩' + (abs / 1e8).toFixed(1) + '억';
  if (abs >= 1e4) return sign + '₩' + (abs / 1e4).toFixed(0) + '만';
  return sign + '₩' + Math.round(abs).toLocaleString('ko-KR');
}

export function fmtUSD(n) {
  if (n == null) return '-';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtQty(n, sym) {
  if (n == null) return '-';
  if (sym === 'BTC') return n.toFixed(8);
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function fmtPct(n) {
  if (n == null) return '-';
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

export function fmtSharePct(n) {
  if (n == null) return '0.0%';
  return n.toFixed(1) + '%';
}

export function fmtDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtAmount(amounts) {
  if (!amounts || amounts.length === 0) return '-';
  return amounts.map(a => {
    const q = a.quantity;
    const c = a.commodity;
    if (c === 'KRW') return fmtKRW(q);
    if (c === 'USD') return fmtUSD(q);
    if (c === 'BTC') return q.toFixed(8) + ' BTC';
    return q.toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' ' + c;
  }).join(', ');
}

export function fmtCumulative(items) {
  if (!items || items.length === 0) return '-';
  return items.map(item => {
    if (item.kind === 'deposit') {
      return `${item.label || '예금'} ${fmtKRW(item.quantity)}`;
    }
    return `${item.commodity} ${fmtQty(item.quantity, item.commodity)}`;
  }).join(' · ');
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function amountTotalKRW(row) {
  return row.total.reduce((sum, amount) => (
    amount.commodity === 'KRW' ? sum + Math.abs(amount.quantity) : sum
  ), 0);
}

export function pnlClass(n) { return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'; }
