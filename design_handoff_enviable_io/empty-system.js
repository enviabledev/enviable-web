/* ==========================================================
   EMPTY-SYSTEM TOGGLE — switches the dashboards to "day one"
   mode, showing what a brand-new Enviable user sees before
   any historical data load has run.
   ========================================================== */
(function () {
  'use strict';

  // Only mount on dashboard pages (those with a KPI row)
  if (!document.querySelector('.kpi-row')) return;

  const KEY = 'eio-system-state';
  let state = localStorage.getItem(KEY) || 'live';
  document.documentElement.setAttribute('data-system-state', state);

  /* ---------- TRANSFORMERS ---------- */
  function blankKpis() {
    document.querySelectorAll('.kpi').forEach(kpi => {
      kpi.classList.add('is-empty');
      kpi.classList.remove('headline', 'is-headline', 'is-ckd', 'is-cbu');
      const val = kpi.querySelector('.kpi-value');
      if (val) {
        const unit = val.querySelector('.kpi-unit');
        const unitHtml = unit ? unit.outerHTML : '';
        const prev = val.textContent;
        let zero = '0';
        if (/₦/.test(prev)) zero = '₦0';
        val.innerHTML = zero + unitHtml;
      }
      const foot = kpi.querySelector('.kpi-foot');
      if (foot) foot.innerHTML = '<span class="kpi-empty-note">No data yet</span>';
      const bar = kpi.querySelector('.kpi-bar');
      if (bar) bar.innerHTML = '';
      const icon = kpi.querySelector('.kpi-icon');
      if (icon) { icon.style.background = 'var(--grey-100)'; icon.style.color = 'var(--grey-400)'; }
    });
  }

  function blankTables() {
    document.querySelectorAll(
      '.shipments-table tbody, .data-table tbody, .dt tbody, .line-table tbody'
    ).forEach(tb => {
      const table = tb.closest('table');
      if (!table) return;
      const cols = (table.querySelectorAll('thead th') || []).length || 6;
      tb.innerHTML = `
        <tr class="day-one-empty-row"><td colspan="${cols}">
          <div class="d1-empty">
            <div class="d1-empty-glyph">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="6" width="18" height="14" rx="1"/><path d="M3 10h18M8 6V4M16 6V4"/></svg>
            </div>
            <div class="d1-empty-title">No records yet</div>
            <div class="d1-empty-msg">Data will appear here as transactions are recorded.</div>
          </div>
        </td></tr>`;
    });
  }

  function blankBars() {
    document.querySelectorAll('.bar-seg, .chart-row .bar-seg').forEach(seg => {
      seg.style.width = '0%';
      seg.textContent = '';
      seg.style.opacity = '0';
    });
    document.querySelectorAll('.bar-track').forEach(t => t.classList.add('day-one-flat'));
  }

  function blankDonut() {
    document.querySelectorAll('.donut-wrap svg g circle').forEach(c => {
      c.style.display = 'none';
    });
    document.querySelectorAll('.donut-center .num').forEach(el => el.textContent = '0');
    document.querySelectorAll('.legend-val').forEach(el => { el.textContent = '0'; el.classList.add('zero-num'); });
    document.querySelectorAll('.legend-pct').forEach(el => el.textContent = '—');
    document.querySelectorAll('.legend-row').forEach(r => r.classList.add('zero'));
  }

  function blankChartCounts() {
    document.querySelectorAll('.chart-count').forEach(el => el.textContent = '0');
    document.querySelectorAll('.chart-share').forEach(el => el.textContent = '—');
  }

  function blankFunnel() {
    document.querySelectorAll('.funnel-cell').forEach(cell => {
      cell.classList.remove('has-count');
      const c = cell.querySelector('.stage-count');
      if (c) c.textContent = '0';
    });
    document.querySelectorAll('.funnel-foot').forEach(f => {
      f.querySelectorAll('b').forEach(b => { if (/PO-/.test(b.textContent)) b.style.display='none'; });
    });
  }

  function blankActivity() {
    document.querySelectorAll('.activity-list').forEach(list => {
      list.innerHTML = `
        <div class="d1-empty" style="padding: 40px 24px;">
          <div class="d1-empty-glyph">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 12h4l2-6 3 12 3-9 2 3h4"/></svg>
          </div>
          <div class="d1-empty-title">No activity yet</div>
          <div class="d1-empty-msg">As users create POs, receive shipments and raise sales orders, their actions will stream here.</div>
        </div>`;
    });
  }

  function blankSparkline() {
    // Sales trend: drop launch marker, keep flat line
    document.querySelectorAll('.trend-svg').forEach(svg => {
      svg.querySelectorAll('text').forEach(t => {
        if (/Launch|May 2026/.test(t.textContent)) t.style.display = 'none';
      });
    });
  }

  function blankApprovalQueue() {
    // Already empty in the executive view; relabel meta
    document.querySelectorAll('.queue-foot').forEach(f => {
      f.innerHTML = '<span>No approvals yet</span>';
    });
  }

  function blankSuppliersGrid() {
    // Procurement dashboard: all groups → empty
    document.querySelectorAll('.supplier-group').forEach(g => {
      g.classList.remove('has');
      g.classList.add('empty');
      const body = g.querySelector('.supplier-group-body');
      const head = g.querySelector('.sg-head-left .sg-title')?.textContent || 'records';
      const count = g.querySelector('.sg-count');
      if (count) count.textContent = '0';
      if (body) body.innerHTML = `
        <div class="supplier-empty">
          No records yet
          <div><a class="add-link" href="#">+ Add</a></div>
        </div>`;
    });
  }

  function blankCardCounts() {
    // Generic chip-style counters in card headers
    document.querySelectorAll('.card-count').forEach(c => {
      const t = c.textContent;
      if (/\d/.test(t)) c.textContent = t.replace(/\d[\d,]*/g, '0');
    });
  }

  function blankStockSummaryStrip() {
    // "Showing X to Y of Z" footers
    document.querySelectorAll('.summary-strip .left').forEach(el => {
      el.innerHTML = '<span style="color: var(--grey-500);">No units in inventory yet</span>';
    });
  }

  function injectBanner() {
    if (document.getElementById('day-one-banner')) return;
    const b = document.createElement('div');
    b.id = 'day-one-banner';
    b.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11v.01"/></svg>
      <div class="dob-text">
        <b>Day one · empty system.</b>
        No data has been loaded yet. Once the IT Admin runs the historical import (or live transactions begin), figures will populate here.
      </div>
      <a class="dob-link" href="Historical Data Load.html">Run import →</a>
    `;
    const target = document.querySelector('.page-header');
    if (target) target.insertAdjacentElement('afterend', b);
  }

  /* ---------- APPLY ---------- */
  function applyDayOne() {
    blankKpis();
    blankTables();
    blankBars();
    blankDonut();
    blankChartCounts();
    blankFunnel();
    blankActivity();
    blankSparkline();
    blankApprovalQueue();
    blankSuppliersGrid();
    blankCardCounts();
    blankStockSummaryStrip();
    injectBanner();
  }

  /* ---------- TOGGLE WIDGET ---------- */
  function injectToggle() {
    if (document.getElementById('system-state-switcher')) return;
    const el = document.createElement('div');
    el.id = 'system-state-switcher';
    el.innerHTML = `
      <div class="rs-head">
        <span>System state</span>
        <span class="rs-warn-dot" title="Day-one view — data is illustrative empty state"></span>
      </div>
      <div class="rs-options">
        <button data-s="live" type="button">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r="6"/></svg>
          Live data
        </button>
        <button data-s="day-one" type="button">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="10" height="10" rx="1"/><path d="M3 7h10M7 3v10"/></svg>
          Day one
        </button>
      </div>
      <div class="rs-foot" id="ss-foot"></div>
    `;
    document.body.appendChild(el);

    function syncUI() {
      el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.s === state));
      const foot = document.getElementById('ss-foot');
      if (!foot) return;
      foot.innerHTML = state === 'day-one'
        ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="10" height="10" rx="1"/></svg><span>Empty state · all values zeroed</span>'
        : '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r="6"/></svg><span>Showing seeded sample data</span>';
    }

    el.addEventListener('click', e => {
      const btn = e.target.closest('button[data-s]');
      if (!btn || btn.dataset.s === state) return;
      state = btn.dataset.s;
      localStorage.setItem(KEY, state);
      // reload to re-apply cleanly (avoids partial-undo bugs)
      location.reload();
    });

    syncUI();
  }

  /* ---------- BOOT ---------- */
  function boot() {
    injectToggle();
    if (state === 'day-one') applyDayOne();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
