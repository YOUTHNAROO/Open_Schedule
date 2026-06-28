/* 자체 디자인 셀렉트 — 네이티브 <select>를 커스텀 드롭다운 위젯으로 대체.
 * - 네이티브 select는 DOM에 그대로 유지(기존 코드의 .value/.options/'change' 동작 보존).
 * - 시각만 커스텀 버튼 + 커스텀 옵션 패널로 표시(펼친 목록까지 자체 디자인).
 * - 동적 옵션 추가/표시 토글(.hidden)/프로그래매틱 값 변경에 대응.
 * - 비모듈 스크립트: index.html / admin.html 양쪽에서 <script src> 로만 로드하면 전 select 자동 적용.
 */
(function () {
  if (window.__csInit) return; window.__csInit = true;

  // 스타일 1회 주입(두 페이지 공통)
  const CSS = `
.cs-native{position:absolute!important;width:1px;height:1px;padding:0!important;margin:-1px;border:0;opacity:0;pointer-events:none;overflow:hidden;clip:rect(0 0 0 0)}
.cs-wrap{position:relative}
.cs-wrap.cs-hidden{display:none}
.cs-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;cursor:pointer;font-family:inherit;background:#fff}
.cs-btn .cs-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.cs-btn.cs-placeholder .cs-label{color:#94a3b8}
.cs-btn .cs-chev{flex:0 0 auto;color:#64748b;transition:transform .15s}
.cs-btn.cs-active .cs-chev{transform:rotate(180deg)}
.cs-btn:disabled{opacity:.55;cursor:not-allowed}
.cs-panel{position:fixed;z-index:99999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 34px rgba(15,23,42,.18);padding:5px;max-height:248px;overflow-y:auto;opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s;pointer-events:none}
.cs-panel.cs-open{opacity:1;transform:translateY(0);pointer-events:auto}
.cs-opt{padding:9px 12px;font-size:14px;border-radius:8px;cursor:pointer;color:#1e293b;white-space:nowrap;display:flex;align-items:center;gap:7px}
.cs-opt:hover{background:#f1f5f9}
.cs-opt.cs-sel{background:#ccfbf1;color:#0f766e;font-weight:700}
.cs-opt.cs-dis{color:#cbd5e1;cursor:default}
.cs-opt.cs-dis:hover{background:transparent}
`;
  const st = document.createElement('style'); st.textContent = CSS; (document.head || document.documentElement).appendChild(st);

  const CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cs-chev"><polyline points="6 9 12 15 18 9"/></svg>';
  let closeOpen = null; // 현재 열린 패널 닫기 함수
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function enhance(sel) {
    if (!sel || sel.dataset.cs || sel.multiple || sel.size > 1) return;
    sel.dataset.cs = '1';

    const wrap = document.createElement('div');
    wrap.className = 'cs-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('cs-native');

    const btn = document.createElement('button');
    btn.type = 'button';
    // 기존 select의 디자인 클래스(테두리/라운드/패딩/배경/포커스링)를 그대로 물려받아 동일한 룩
    const inherit = sel.className.split(/\s+/).filter(c => c && c !== 'cs-native' && c !== 'hidden').join(' ');
    btn.className = 'cs-btn ' + inherit;
    btn.innerHTML = '<span class="cs-label"></span>' + CHEV;
    wrap.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'cs-panel';

    function syncLabel() {
      const o = sel.options[sel.selectedIndex];
      btn.querySelector('.cs-label').textContent = o ? o.textContent : '';
      btn.classList.toggle('cs-placeholder', !!(o && o.value === ''));
      btn.disabled = sel.disabled;
    }
    function mirrorVis() {
      const hidden = sel.classList.contains('hidden') || sel.style.display === 'none';
      wrap.classList.toggle('cs-hidden', hidden);
    }
    function buildPanel() {
      panel.innerHTML = [...sel.options].map((o, i) =>
        `<div class="cs-opt${i === sel.selectedIndex ? ' cs-sel' : ''}${o.disabled ? ' cs-dis' : ''}" data-i="${i}">${esc(o.textContent)}</div>`).join('');
    }
    function position() {
      const r = btn.getBoundingClientRect();
      panel.style.minWidth = r.width + 'px';
      panel.style.maxWidth = Math.max(r.width, 280) + 'px';
      panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)) + 'px';
      const below = window.innerHeight - r.bottom;
      if (below < 250 && r.top > below) { panel.style.top = 'auto'; panel.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
      else { panel.style.bottom = 'auto'; panel.style.top = (r.bottom + 4) + 'px'; }
    }
    function open() {
      if (sel.disabled) return;
      if (closeOpen) closeOpen();
      buildPanel(); document.body.appendChild(panel); position();
      requestAnimationFrame(() => panel.classList.add('cs-open'));
      btn.classList.add('cs-active');
      closeOpen = close;
      const s = panel.querySelector('.cs-sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    }
    function close() {
      panel.classList.remove('cs-open'); btn.classList.remove('cs-active');
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      if (closeOpen === close) closeOpen = null;
    }
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); (panel.classList.contains('cs-open') ? close : open)(); });
    panel.addEventListener('click', e => {
      const opt = e.target.closest('.cs-opt'); if (!opt || opt.classList.contains('cs-dis')) return;
      const i = +opt.dataset.i;
      if (i !== sel.selectedIndex) {
        sel.selectedIndex = i;
        syncLabel(); close();
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      } else { close(); }
    });
    sel.addEventListener('change', syncLabel);
    // 동적 옵션/표시/disabled 변경 반영
    new MutationObserver(() => { syncLabel(); mirrorVis(); }).observe(sel, { attributes: true, attributeFilter: ['class', 'style', 'disabled'], childList: true });
    syncLabel(); mirrorVis();
    setTimeout(syncLabel, 0); // 직후 프로그래매틱 value 설정 캐치
  }

  function scan(root) { try { (root || document).querySelectorAll('select:not([data-cs])').forEach(enhance); } catch {} }

  // 바깥 클릭/스크롤/리사이즈/ESC 시 닫기
  document.addEventListener('click', () => { if (closeOpen) closeOpen(); });
  window.addEventListener('resize', () => { if (closeOpen) closeOpen(); });
  document.addEventListener('scroll', () => { if (closeOpen) closeOpen(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && closeOpen) closeOpen(); });

  function init() {
    scan();
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SELECT') enhance(n); else scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
