// 결산 탭: 연도/월 토글 버튼으로 월을 선택하면 해당 리포트를 iframe으로 표시하고,
// 우측에 따라다니는 목차(클릭 이동 + scrollspy)를 구성한다.

let initialized = false;
const cacheBust = Date.now();

export async function loadSettlement() {
  if (initialized) return;
  initialized = true;

  const yearGroup = document.getElementById('settlement-year-group');
  const monthGroup = document.getElementById('settlement-month-group');
  const frame = document.getElementById('settlement-frame');
  const empty = document.getElementById('settlement-empty');
  const toc = document.getElementById('settlement-toc');

  let items;
  try {
    const res = await fetch('/api/reports');
    items = await res.json();
  } catch (err) {
    empty.hidden = false;
    empty.textContent = '결산 리포트 목록을 불러오지 못했습니다.';
    frame.style.display = 'none';
    return;
  }

  // byYear: { '2026': { '05': { src, title }, ... }, ... }
  const byYear = {};
  items.forEach((m) => {
    if (!m.files.length) return;
    const [year, month] = m.month.split('-');
    const f = m.files[0];
    (byYear[year] ||= {})[month] = {
      src: `/report/${m.month}/${encodeURIComponent(f.name)}?t=${cacheBust}`,
    };
  });

  const years = Object.keys(byYear).sort().reverse();
  if (years.length === 0) {
    empty.hidden = false;
    frame.style.display = 'none';
    return;
  }

  let curYear = years[0];
  frame.addEventListener('load', () => buildToc(frame, toc));

  function renderYears() {
    yearGroup.innerHTML = years
      .map((y) => `<button class="filter-btn${y === curYear ? ' active' : ''}" data-year="${y}">${y}</button>`)
      .join('');
    yearGroup.querySelectorAll('.filter-btn').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.year === curYear) return;
        curYear = b.dataset.year;
        renderYears();
        renderMonths();
      }),
    );
  }

  function renderMonths() {
    const months = Object.keys(byYear[curYear]).sort().reverse();
    monthGroup.innerHTML = months
      .map((mo) => `<button class="filter-btn" data-month="${mo}">${Number(mo)}월</button>`)
      .join('');
    monthGroup.querySelectorAll('.filter-btn').forEach((b) =>
      b.addEventListener('click', () => selectMonth(b.dataset.month)),
    );
    selectMonth(months[0]);
  }

  function selectMonth(mo) {
    monthGroup.querySelectorAll('.filter-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.month === mo),
    );
    frame.src = byYear[curYear][mo].src;
  }

  renderYears();
  renderMonths(); // 진입 시 최신 연도·최신 월 자동 표시
}

function buildToc(frame, toc) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const headings = [...doc.querySelectorAll('h2, h3')];
  toc.innerHTML = '';
  if (headings.length === 0) return;

  const links = [];
  headings.forEach((h, i) => {
    if (!h.id) h.id = `sec-${i}`;
    const a = document.createElement('a');
    a.textContent = h.textContent.trim();
    a.href = `#${h.id}`;
    if (h.tagName === 'H3') a.classList.add('toc-h3');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toc.appendChild(a);
    links.push({ a, h });
  });

  const win = frame.contentWindow;
  const spy = () => {
    let activeIdx = 0;
    links.forEach(({ h }, i) => {
      if (h.getBoundingClientRect().top <= 90) activeIdx = i;
    });
    links.forEach(({ a }, i) => a.classList.toggle('active', i === activeIdx));
  };
  win.addEventListener('scroll', spy, { passive: true });
  spy();
}
