import { amountTotalKRW, fmtKRW } from './formatters.js';

export function categoryLabel(account) {
  const parts = account.split(':');
  return parts[1] || parts[parts.length - 1] || account;
}

export function categoryDetailLabel(account) {
  const parts = account.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : account;
}

export function buildCategoryGroups(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const value = amountTotalKRW(row);
    if (!value) continue;
    const label = categoryLabel(row.account);
    const detailLabel = categoryDetailLabel(row.account);
    if (!grouped.has(label)) {
      grouped.set(label, {
        label,
        value: 0,
        details: new Map(),
      });
    }
    const group = grouped.get(label);
    group.value += value;
    group.details.set(detailLabel, (group.details.get(detailLabel) || 0) + value);
  }

  return [...grouped.values()]
    .map(group => ({
      label: group.label,
      value: group.value,
      details: [...group.details.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
}

export function categoryTooltipLines(group) {
  return group.details.map(detail => {
    const pct = group.value > 0 ? (detail.value / group.value) * 100 : 0;
    return `${detail.label} ${fmtKRW(detail.value)} (${pct.toFixed(1)}%)`;
  });
}

export function subcategoryBucketLabel(detailLabel, groupLabel) {
  let path = detailLabel || '';
  if (path === groupLabel) {
    return groupLabel;
  } else if (path.startsWith(groupLabel + ':')) {
    path = path.slice(groupLabel.length + 1);
  }
  return (path.split(':')[0] || groupLabel).trim() || groupLabel;
}

export function compareExpenseEntries(a, b) {
  if ((a.date || '') !== (b.date || '')) {
    return (b.date || '').localeCompare(a.date || '');
  }
  if ((a.amount || 0) !== (b.amount || 0)) {
    return (b.amount || 0) - (a.amount || 0);
  }
  return (a.description || '').localeCompare(b.description || '', 'ko-KR');
}

export function buildSubcategoryTransactionIndex(transactions) {
  const grouped = new Map();

  for (const txn of transactions || []) {
    const account = txn.account || '';
    if (!account.startsWith('expenses:')) continue;

    const amount = (txn.amounts || []).reduce((sum, item) => (
      item.commodity === 'KRW' ? sum + Math.abs(item.quantity) : sum
    ), 0);
    if (!amount) continue;

    const groupLabel = categoryLabel(account);
    if (!groupLabel) continue;

    const childLabel = subcategoryBucketLabel(categoryDetailLabel(account), groupLabel);
    if (!grouped.has(groupLabel)) {
      grouped.set(groupLabel, new Map());
    }
    const childGroups = grouped.get(groupLabel);
    if (!childGroups.has(childLabel)) {
      childGroups.set(childLabel, new Map());
    }

    const entries = childGroups.get(childLabel);
    const entryKey = `${txn.transaction_id || `${txn.date || ''}|${txn.description || ''}`}|${account}`;
    if (!entries.has(entryKey)) {
      entries.set(entryKey, {
        date: txn.date || '',
        description: txn.description || account,
        amount: 0,
      });
    }
    entries.get(entryKey).amount += amount;
  }

  return new Map(
    [...grouped.entries()].map(([groupLabel, childGroups]) => [
      groupLabel,
      new Map(
        [...childGroups.entries()].map(([childLabel, entries]) => [
          childLabel,
          [...entries.values()].sort(compareExpenseEntries),
        ])
      ),
    ])
  );
}

export function subcategoryTooltipLines(item, maxEntries = 8) {
  const entries = item.entries || [];
  if (entries.length === 0) return [];

  const visible = entries.slice(0, maxEntries);
  const lines = visible.map(entry => (
    `${entry.date} ${entry.description} ${fmtKRW(entry.amount)}`
  ));
  if (entries.length > visible.length) {
    lines.push(`외 ${entries.length - visible.length}건`);
  }
  return lines;
}

export function buildSubcategoryBreakdown(group, transactionIndex) {
  const buckets = new Map();
  const childEntries = transactionIndex?.get(group.label) || new Map();

  for (const detail of group.details || []) {
    const childLabel = subcategoryBucketLabel(detail.label, group.label);
    if (!buckets.has(childLabel)) {
      buckets.set(childLabel, {
        label: childLabel,
        value: 0,
        entries: [],
      });
    }
    buckets.get(childLabel).value += detail.value;
  }

  for (const [childLabel, entries] of childEntries.entries()) {
    if (!buckets.has(childLabel)) {
      buckets.set(childLabel, {
        label: childLabel,
        value: entries.reduce((sum, entry) => sum + (entry.amount || 0), 0),
        entries: [],
      });
    }
    buckets.get(childLabel).entries = entries;
  }

  return [...buckets.values()]
    .sort((a, b) => b.value - a.value);
}
