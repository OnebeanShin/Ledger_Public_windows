/* ── Chart theme ─────────────────────────────────────── */

export const ASSET_COLOR_MAP = {
  '현금':  '#4a8ab5',
  '예금':  '#6b8f71',
  'GOOGL': '#5a9a44',
  'MSFT':  '#3a78b5',
  'MSTR':  '#c47a2a',
  'BTC':   '#e8a020',
  '부채':  '#c45050',
};

export const CHART_COLORS = [
  '#4a8ab5', // Muted Blue
  '#d9534f', // Red
  '#5cb85c', // Green
  '#9b59b6', // Purple
  '#f0ad4e', // Yellow-Orange
  '#1abc9c', // Teal
  '#e84393', // Pink
  '#34495e', // Dark Blue-Gray
  '#d35400', // Burnt Orange
  '#27ae60', // Darker Green
  '#8e44ad', // Darker Purple
  '#2980b9', // Darker Blue
  '#e67e22', // Orange
  '#16a085', // Darker Teal
  '#c0392b', // Dark Red
];

export const CATEGORY_COLORS = {
  '식비': '#5cb85c',   // 음식
  '주거': '#95a5a6',   // 주거/공과금
  '교통': '#5b8def',   // 교통
  '의료': '#d9534f',   // 의료/건강
  '여가': '#f0ad4e',   // 여가/문화
  '쇼핑': '#c87a95',   // 쇼핑
  '구독': '#8e44ad',   // 구독/통신
  '이자': '#555555',   // 이자/금융
};

export const PHONE_MEDIA_QUERY = '(max-width: 767px), (max-height: 480px) and (pointer: coarse)';

export function isPhoneViewport() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(PHONE_MEDIA_QUERY).matches;
  }
  return window.innerWidth < 768;
}

export function getCategoryColor(categoryName, index) {
  if (categoryName) {
    const baseCat = categoryName.split(':')[0];
    if (CATEGORY_COLORS[baseCat]) {
      return CATEGORY_COLORS[baseCat];
    }
  }
  return CHART_COLORS[index % CHART_COLORS.length];
}
Chart.defaults.color = '#4a4a4a';
Chart.defaults.font.size = 13;
Chart.defaults.borderColor = '#e0dfda';
Chart.defaults.font.family = "'IBM Plex Mono', 'SF Mono', 'Consolas', monospace";

export const doughnutOuterLabelsPlugin = {
  id: 'doughnutOuterLabels',
  afterDatasetsDraw(chart, _args, options) {
    if (!options?.display) return;
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];
    const labels = chart.data.labels || [];
    if (!meta?.data?.length || !dataset) return;

    const ctx = chart.ctx;
    const textColor = options.color || '#4a4a4a';
    const lineColor = options.lineColor || '#b8b6af';
    const fontSize = options.fontSize || 12;
    const fontFamily = options.fontFamily || Chart.defaults.font.family;
    const lineLength = options.lineLength || 14;
    const elbowLength = options.elbowLength || 16;
    const textPadding = options.textPadding || 6;
    const minGap = options.minGap || fontSize + 8;
    const edgePadding = options.edgePadding || 4;
    const minY = edgePadding + fontSize / 2;
    const maxY = Math.max(minY, chart.height - edgePadding - fontSize / 2);
    const formatter = typeof options.formatter === 'function' ? options.formatter : null;
    const total = (dataset.data || []).reduce((sum, datum) => {
      const value = Number(datum);
      return Number.isFinite(value) ? sum + Math.abs(value) : sum;
    }, 0);

    ctx.save();
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = textColor;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;

    const positionedLabels = [];

    meta.data.forEach((arc, index) => {
      const value = Number(dataset.data[index]);
      const rawLabel = labels[index];
      if (!rawLabel || !value) return;
      const percentage = total > 0 ? (Math.abs(value) / total) * 100 : 0;
      const label = formatter
        ? formatter({
          chart,
          dataset,
          index,
          label: rawLabel,
          value,
          total,
          percentage,
        })
        : rawLabel;
      if (!label) return;

      const {
        x, y, startAngle, endAngle, outerRadius,
      } = arc.getProps(['x', 'y', 'startAngle', 'endAngle', 'outerRadius'], true);

      const angle = (startAngle + endAngle) / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const lineStartX = x + cos * outerRadius;
      const lineStartY = y + sin * outerRadius;
      const lineMidX = x + cos * (outerRadius + lineLength);
      const lineMidY = y + sin * (outerRadius + lineLength);
      const isRight = cos >= 0;
      const lineEndX = x + (isRight ? 1 : -1) * (outerRadius + lineLength + elbowLength);

      positionedLabels.push({
        label,
        lineStartX,
        lineStartY,
        lineMidX,
        lineMidY,
        lineEndX,
        isRight,
        naturalY: lineMidY,
      });
    });

    const spreadLabels = items => {
      const sorted = [...items].sort((a, b) => a.naturalY - b.naturalY);
      const gap = sorted.length > 1
        ? Math.min(minGap, Math.max(1, (maxY - minY) / (sorted.length - 1)))
        : minGap;

      sorted.forEach((item, index) => {
        const previous = sorted[index - 1];
        const minAllowedY = previous ? previous.textY + gap : minY;
        item.textY = Math.min(maxY, Math.max(item.naturalY, minAllowedY));
      });

      for (let i = sorted.length - 2; i >= 0; i -= 1) {
        sorted[i].textY = Math.min(sorted[i].textY, sorted[i + 1].textY - gap);
      }

      if (sorted[0]) {
        const topOverflow = minY - sorted[0].textY;
        if (topOverflow > 0) {
          sorted.forEach(item => {
            item.textY += topOverflow;
          });
        }
      }

      return sorted;
    };

    [
      ...spreadLabels(positionedLabels.filter(item => !item.isRight)),
      ...spreadLabels(positionedLabels.filter(item => item.isRight)),
    ].forEach(item => {
      const measuredWidth = ctx.measureText(item.label).width;
      const rawTextX = item.lineEndX + (item.isRight ? textPadding : -textPadding);
      const textX = item.isRight
        ? Math.min(rawTextX, chart.width - measuredWidth - textPadding)
        : Math.max(rawTextX, measuredWidth + textPadding);

      ctx.beginPath();
      ctx.moveTo(item.lineStartX, item.lineStartY);
      ctx.lineTo(item.lineMidX, item.lineMidY);
      ctx.lineTo(item.lineEndX, item.textY);
      ctx.lineTo(textX - (item.isRight ? textPadding : -textPadding), item.textY);
      ctx.stroke();

      ctx.textAlign = item.isRight ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, textX, item.textY);
    });

    ctx.restore();
  },
};
