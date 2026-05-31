import { loadSummary } from './summary.js';
import { loadTransactions } from './transactions.js';
import { loadReports } from './reports.js';
import { loadAccounts } from './accounts.js';
import { loadPortfolio } from './portfolio.js';
import { loadSettlement } from './settlement.js';

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const subTabBtns = document.querySelectorAll('.sub-tab-btn');
const tabLoaders = {};
const subTabLoaders = {};
const loaders = {
  summary: loadSummary,
  transactions: loadTransactions,
  reports: loadReports,
  portfolio: loadPortfolio,
  settlement: loadSettlement,
};
const subLoaders = {
  'reports:accounts': loadAccounts,
};
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function loadTab(tab) {
  loaders[tab]?.();
}

function canUseViewTransition() {
  return 'startViewTransition' in document && !reduceMotionQuery.matches;
}

function withViewTransition(kind, update) {
  if (!canUseViewTransition()) {
    update();
    return;
  }

  document.documentElement.dataset.tabTransition = kind;
  const transition = document.startViewTransition(update);
  transition.finished.finally(() => {
    delete document.documentElement.dataset.tabTransition;
  });
}

function setButtonState(buttons, activeBtn) {
  buttons.forEach(btn => {
    const isActive = btn === activeBtn;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function setPanelState(panels, activePanel) {
  panels.forEach(panel => {
    const isActive = panel === activePanel;
    panel.classList.toggle('active', isActive);
    panel.toggleAttribute('hidden', !isActive);
  });
}

function activateTab(btn) {
  const tab = btn.dataset.tab;
  const activeBtn = document.querySelector('.tab-btn.active');
  if (!tab || btn === activeBtn) return;

  const activePanel = document.getElementById('tab-' + tab);
  const direction = [...tabBtns].indexOf(btn) > [...tabBtns].indexOf(activeBtn) ? 'forward' : 'back';

  withViewTransition(direction, () => {
    setButtonState(tabBtns, btn);
    setPanelState(tabContents, activePanel);
  });

  if (!tabLoaders[tab]) {
    tabLoaders[tab] = true;
    loadTab(tab);
  }
}

function activateSubTab(btn) {
  const parent = btn.closest('.tab-content');
  const sub = btn.dataset.sub;
  if (!parent || !sub || btn.classList.contains('active')) return;

  const activePanel = document.getElementById('sub-' + sub);
  const loaderKey = `${parent.id.replace(/^tab-/, '')}:${sub}`;
  withViewTransition('sub', () => {
    setButtonState(parent.querySelectorAll('.sub-tab-btn'), btn);
    setPanelState(parent.querySelectorAll('.sub-content'), activePanel);
  });

  if (!subTabLoaders[loaderKey]) {
    subTabLoaders[loaderKey] = true;
    subLoaders[loaderKey]?.();
  }
}

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn));
});

subTabBtns.forEach(btn => {
  btn.addEventListener('click', () => activateSubTab(btn));
});

setButtonState(tabBtns, document.querySelector('.tab-btn.active'));
setPanelState(tabContents, document.querySelector('.tab-content.active'));
document.querySelectorAll('.tab-content').forEach(parent => {
  setButtonState(parent.querySelectorAll('.sub-tab-btn'), parent.querySelector('.sub-tab-btn.active'));
  setPanelState(parent.querySelectorAll('.sub-content'), parent.querySelector('.sub-content.active'));
});

tabLoaders.summary = true;
loadSummary();
