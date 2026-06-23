import S from './state.js';
import { HOURS } from './constants.js';

function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr), now = new Date(), diff = now - d;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderTagged(text) {
    return String(text).replace(/@([\w가-힣]+)/g, '<span class="text-teal-600 font-semibold">@$1</span>');
}

function _makeFloatingDropdown() {
    const dd = document.createElement('div');
    dd.className = 'fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-xl max-h-44 overflow-y-auto hidden';
    document.body.appendChild(dd);
    return dd;
}

function _positionDropdown(dd, el) {
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    dd.style.width = rect.width + 'px';
    dd.style.left = rect.left + 'px';
    if (spaceBelow >= 100) {
        dd.style.top = (rect.bottom + 4) + 'px';
        dd.style.bottom = 'auto';
    } else {
        dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        dd.style.top = 'auto';
    }
}

function setupTagInput(el) {
    if (!el || el._tagSetup) return;
    el._tagSetup = true;
    const dd = _makeFloatingDropdown();

    const refresh = () => {
        const val = el.value;
        const pos = el.selectionStart != null ? el.selectionStart : val.length;
        let at = -1;
        for (let i = pos - 1; i >= 0; i--) {
            if (val[i] === '@') { at = i; break; }
            if (/[\s\n]/.test(val[i])) break;
        }
        if (at < 0) { dd.classList.add('hidden'); return; }
        const q = val.slice(at + 1, pos).toLowerCase();
        const hits = S.USERS_CACHE.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.displayName || '').toLowerCase().includes(q)
        ).slice(0, 6);
        if (!hits.length) { dd.classList.add('hidden'); return; }
        dd.innerHTML = hits.map(u =>
            `<div class="tag-opt flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-teal-50" data-un="${esc(u.username)}">
                <span class="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-[10px] font-bold flex items-center justify-center shrink-0">${esc((u.displayName||'?')[0])}</span>
                <span class="text-sm font-semibold text-slate-800">${esc(u.displayName)}</span>
                <span class="text-xs text-slate-400 ml-auto">@${esc(u.username)}</span>
            </div>`
        ).join('');
        _positionDropdown(dd, el);
        dd.classList.remove('hidden');
        dd.querySelectorAll('.tag-opt').forEach(opt => {
            opt.addEventListener('mousedown', ev => {
                ev.preventDefault();
                const un = opt.dataset.un;
                const before = val.slice(0, at);
                const after = val.slice(pos);
                el.value = `${before}@${un} ${after}`;
                el.selectionStart = el.selectionEnd = at + un.length + 2;
                dd.classList.add('hidden');
                el.dispatchEvent(new Event('input'));
            });
        });
    };
    el.addEventListener('input', refresh);
    el.addEventListener('keyup', refresh);
    el.addEventListener('click', refresh);
    el.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
}

// 담당자 전용 태그 입력: 선택 시 @username 대신 displayName 삽입
function setupPersonTagInput(el) {
    if (!el || el._personTagSetup) return;
    el._personTagSetup = true;
    const dd = _makeFloatingDropdown();
    let _selecting = false;
    const refresh = () => {
        if (_selecting) return;
        const q = (el.value || '').replace(/^@/, '').toLowerCase().trim();
        if (!q) { dd.classList.add('hidden'); return; }
        const hits = S.USERS_CACHE.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.displayName || '').toLowerCase().includes(q)
        ).slice(0, 6);
        if (!hits.length) { dd.classList.add('hidden'); return; }
        dd.innerHTML = hits.map(u =>
            `<div class="person-opt flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-teal-50" data-name="${esc(u.displayName)}" data-un="${esc(u.username)}">
                <span class="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-[10px] font-bold flex items-center justify-center shrink-0">${esc((u.displayName||'?')[0])}</span>
                <span class="text-sm font-semibold text-slate-800">${esc(u.displayName)}</span>
                <span class="text-xs text-slate-400 ml-auto">@${esc(u.username)}</span>
            </div>`
        ).join('');
        _positionDropdown(dd, el);
        dd.classList.remove('hidden');
        dd.querySelectorAll('.person-opt').forEach(opt => {
            opt.addEventListener('mousedown', ev => {
                ev.preventDefault();
                _selecting = true;
                el.value = opt.dataset.name;
                dd.classList.add('hidden');
                setTimeout(() => { _selecting = false; }, 200);
            });
        });
    };
    el.addEventListener('input', refresh);
    el.addEventListener('keyup', refresh);
    el.addEventListener('click', refresh);
    el.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 150));
}

function buildMergedReservations(dayRaw, dayFixedList) {
    const merged = {};
    dayFixedList.forEach(fs => {
        const hours = expandHourRange(fs.startHour, fs.endHour);
        hours.forEach(h => {
            const key = `${h}-${fs.room}`.replace(/\//g, '_');
            merged[key] = {
                teamId: fs.teamId,
                teamName: fs.teamName,
                userName: '고정 일정',
                userId: 'system',
                isFixed: true,
                note: fs.note || ''
            };
        });
    });
    Object.entries(dayRaw).forEach(([key, val]) => {
        if (!merged[key]) merged[key] = val;
    });
    return merged;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    if (!toast || !msg) return;
    msg.textContent = message;
    const base = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold max-w-sm w-full pointer-events-none transition-all duration-300';
    if (type === 'success') { toast.className = base + ' bg-emerald-600'; if (icon) icon.setAttribute('data-lucide', 'check-circle'); }
    else if (type === 'error') { toast.className = base + ' bg-red-600'; if (icon) icon.setAttribute('data-lucide', 'alert-circle'); }
    else { toast.className = base + ' bg-blue-600'; if (icon) icon.setAttribute('data-lucide', 'info'); }
    toast.classList.remove('opacity-0', 'translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
    lucide.createIcons();
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-4');
    }, 3000);
}

function showModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function showConfirm(msg, { title = '확인', okText = '확인', danger = false } = {}) {
    return new Promise(resolve => {
        const modal   = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl   = document.getElementById('confirm-modal-msg');
        const okBtn   = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        const header  = document.getElementById('confirm-modal-header');
        const icon    = document.getElementById('confirm-modal-icon');
        if (!modal) { resolve(window.confirm(msg)); return; }

        if (titleEl) titleEl.textContent = title;
        if (msgEl)   msgEl.textContent = msg;
        if (okBtn)   { okBtn.textContent = okText; okBtn.className = `flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`; }
        if (header)  header.className = `h-1.5 w-full ${danger ? 'bg-red-500' : 'bg-amber-400'}`;
        if (icon)    icon.className = `w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${danger ? 'bg-red-50' : 'bg-amber-50'}`;

        modal.classList.remove('hidden');
        lucide.createIcons();

        const cleanup = () => modal.classList.add('hidden');
        okBtn.onclick     = () => { cleanup(); resolve(true); };
        cancelBtn.onclick = () => { cleanup(); resolve(false); };
        document.getElementById('confirm-modal-backdrop').onclick = () => { cleanup(); resolve(false); };
    });
}

function expandHourRange(startHour, endHour) {
    const si = HOURS.indexOf(startHour);
    const ei = HOURS.indexOf(endHour);
    if (si < 0 || ei < 0 || ei <= si) return [];
    return HOURS.slice(si, ei);
}

async function fetchClientIP() {
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        S.clientIP = (await r.json()).ip;
    } catch { S.clientIP = '알 수 없음'; }
}


export { formatTime, renderTagged, _makeFloatingDropdown, _positionDropdown, setupTagInput, setupPersonTagInput, buildMergedReservations, showToast, showModal, hideModal, showConfirm, expandHourRange, fetchClientIP };
