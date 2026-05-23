/* ==========================================================
   ROLE-SWITCHER — adds a floating "Viewing as" toggle to
   every screen. When switched to "Sales Officer", cost /
   landed cost / margin / profit fields are hidden across
   the whole prototype.
   ========================================================== */
(function () {
  'use strict';
  const KEY = 'eio-viewer-role';
  const ROLES = {
    'it-admin':      { label: 'IT Admin',      hide: false },
    'sales-officer': { label: 'Sales Officer', hide: true  }
  };
  let role = localStorage.getItem(KEY) || 'it-admin';
  if (!ROLES[role]) role = 'it-admin';
  document.documentElement.setAttribute('data-role', role);

  /* ---------- DETECTION ---------- */
  // Exact-ish label matches for KV rows, column headers, KPIs
  const EXACT_HIDE = /^\s*(?:total\s+)?(?:landed\s+cost|gross\s+margin|net\s+margin|margin|profit|cost\s+basis|cost\s+component|cogs|cost(?:\s+data)?(?:\s+breakdown)?(?:\s+per\s+unit)?|landed\s+cost\s+per\s+unit|total\s+landed\s+cost|landed\s+cost\s*\/\s*unit|landed\s+cost\s*[·\-]\s*ngn)\s*[·:]?\s*(?:·\s*ngn)?\s*$/i;
  // Looser containment match for activity rows / nav items
  const CONTAINS = /landed\s+cost|gross\s+margin|net\s+margin|profit\b|cost\s+basis|cogs/i;

  function exactMatch(t) { return t && EXACT_HIDE.test(t.trim()); }
  function contains(t)   { return t && CONTAINS.test(t); }

  /* ---------- HIDERS ---------- */
  function hideTableColumns(table) {
    const heads = table.querySelectorAll('thead th');
    const idx = [];
    heads.forEach((th, i) => { if (exactMatch(th.textContent) || contains(th.textContent)) idx.push(i); });
    if (!idx.length) return;
    heads.forEach((th, i) => { if (idx.includes(i)) markHide(th); });
    table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
      const cells = tr.children;
      idx.forEach(i => { if (cells[i]) markHide(cells[i]); });
    });
  }

  function hideKvRows() {
    document.querySelectorAll('.kv, .kv-row, .summary-kv, .bg-kv, .pdf-meta-block, .sc-grid > div')
      .forEach(row => {
        const k = row.querySelector('.k, .pdf-meta-head, [class*="meta-head"]') || row;
        const txt = (k.textContent || '').split('\n')[0];
        if (exactMatch(txt) || contains(txt)) markHide(row);
      });
  }

  function hideKpiCards() {
    document.querySelectorAll('.kpi').forEach(kpi => {
      const lbl = kpi.querySelector('.kpi-label');
      if (lbl && (exactMatch(lbl.textContent) || contains(lbl.textContent))) markHide(kpi);
    });
  }

  function hideTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const t = btn.textContent;
      if (exactMatch(t) || contains(t)) {
        markHide(btn);
        const tab = btn.dataset.tab;
        if (tab) {
          const panel = document.getElementById('tab-' + tab);
          if (panel) markHide(panel);
        }
      }
    });
  }

  function hideCardsByTitle() {
    document.querySelectorAll('.card-title, .form-card-title, .summary-title, .timeline-title, .docs-title')
      .forEach(t => {
        if (exactMatch(t.textContent) || contains(t.textContent)) {
          const card = t.closest('.card, .form-card, .summary-card, .tabs-card, .form-card, section.card');
          if (card) markHide(card);
        }
      });
  }

  function hideActivityRows() {
    document.querySelectorAll('.activity-row, .entry, .notif-item').forEach(row => {
      if (contains(row.textContent || '')) markHide(row);
    });
  }

  function hideStockBreakdownColumn() {
    // Stocks Report: hide entire "Landed Cost / Unit" and "Total Landed Cost" columns
    // already handled by hideTableColumns
    // Also hide entire Spare Parts table if its purpose is cost reporting? Keep visible.
  }

  function markHide(el) { el.setAttribute('data-role-hide', '1'); }

  /* ---------- SPECIAL CASES ---------- */
  function specialUnitDetail() {
    const landed = document.getElementById('landedRow');
    if (!landed) return;
    if (!landed.dataset.original) landed.dataset.original = landed.innerHTML;
    if (ROLES[role].hide) {
      landed.innerHTML = `
        <div class="k">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="6" rx="1"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>
          Landed Cost
          <span class="gate-tag" style="background: var(--grey-100); color: var(--grey-500); border: 1px solid var(--grey-200);">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="10" height="6" rx="1"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>
            Restricted
          </span>
        </div>
        <div class="v" style="display:flex;align-items:center;gap:8px;color:var(--grey-500);font-weight:500;font-style:italic;">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="6" rx="1"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>
          Cost data not visible at your access level
        </div>`;
      landed.style.background = 'var(--grey-100)';
      // Hide the demo role-banner toggle since the real switcher is now in play
      const banner = document.querySelector('.role-banner');
      if (banner) markHide(banner);
    } else {
      landed.innerHTML = landed.dataset.original;
      landed.style.background = '';
    }
  }

  function specialReceiveShipment() {
    // Hide the Landed Cost summary stat in the bottom summary panel
    document.querySelectorAll('.bs-stat').forEach(s => {
      const lbl = s.querySelector('.bs-stat-text .label');
      if (lbl && /landed cost docs?/i.test(lbl.textContent)) markHide(s);
    });
  }

  function specialDashboard() {
    // Hide "landed cost invoice" notification row, if present
    document.querySelectorAll('.notif-item, .activity-row').forEach(r => {
      if (/landed cost/i.test(r.textContent)) markHide(r);
    });
  }

  function specialPriceListNote() {
    // Sales screens already show only sale price — nothing to hide
  }

  /* ---------- APPLY / RESET ---------- */
  function clearHidden() {
    document.querySelectorAll('[data-role-hide]').forEach(el => el.removeAttribute('data-role-hide'));
  }

  function apply() {
    clearHidden();
    if (ROLES[role].hide) {
      document.querySelectorAll('table').forEach(hideTableColumns);
      hideKvRows();
      hideKpiCards();
      hideTabs();
      hideCardsByTitle();
      hideActivityRows();
      specialReceiveShipment();
      specialDashboard();
    }
    specialUnitDetail();
  }

  /* ---------- TOGGLE WIDGET ---------- */
  function injectToggle() {
    if (document.getElementById('role-switcher')) return;
    const el = document.createElement('div');
    el.id = 'role-switcher';
    el.innerHTML = `
      <div class="rs-head">
        <span>Viewing as</span>
        <span class="rs-warn-dot" title="Sales Officer view hides cost data"></span>
      </div>
      <div class="rs-options">
        <button data-r="it-admin" type="button">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2.5a2.5 2.5 0 00-2.5 2.5c0 .4.1.8.2 1.2L3 13l1.5 1.5 6.8-6.8c.4.1.8.2 1.2.2a2.5 2.5 0 00.5-4.9l-1.4 1.4-1-1 1.4-1.4c-.3 0-.6 0-1 0z"/></svg>
          IT Admin
        </button>
        <button data-r="sales-officer" type="button">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 4h2.2l1.4 6.6a1 1 0 001 .8h5.4a1 1 0 001-.8L14 6H5.5"/><circle cx="6.5" cy="13.5" r="1"/><circle cx="12" cy="13.5" r="1"/></svg>
          Sales Officer
        </button>
      </div>
      <div class="rs-foot" id="rs-foot"></div>
    `;
    document.body.appendChild(el);

    function syncUI() {
      el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.r === role));
      const foot = document.getElementById('rs-foot');
      if (!foot) return;
      foot.innerHTML = role === 'sales-officer'
        ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="10" height="6" rx="1"/><path d="M5 7V5a3 3 0 016 0v2"/></svg><span>Cost &amp; margin data hidden</span>'
        : '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="M5 8l2 2 4-4"/></svg><span>Full access · all fields visible</span>';
    }

    el.addEventListener('click', e => {
      const btn = e.target.closest('button[data-r]');
      if (!btn || btn.dataset.r === role) return;
      role = btn.dataset.r;
      localStorage.setItem(KEY, role);
      document.documentElement.setAttribute('data-role', role);
      syncUI();
      apply();
    });

    syncUI();
  }

  /* ---------- BOOT ---------- */
  function boot() { injectToggle(); apply(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
