import S from './state.js';
import { HOURS, DAYS, FLOORS, ALL_ROOMS } from './constants.js';
import { getWeekId, esc, getWeekDateRange, getWeeksInMonth, formatWeekLabel } from './utils.js';
import { showToast } from './ui.js';
import { addFixedScheduleRange } from './fixed.js';
import { clearAllSubscriptions, subscribeToReservations, subscribeToFixedSchedules, subscribeToActivityLogs, subscribeRoomBlocks } from './data.js';
import { renderDayTabs } from './render.js';

// ==================== LEFT NAV SIDEBAR ====================
let leftNavMonth = new Date();


function renderLeftNav() {
    const year = leftNavMonth.getFullYear();
    const month = leftNavMonth.getMonth();

    const monthLabel = document.getElementById('left-nav-month-label');
    if (monthLabel) monthLabel.textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById('left-nav-calendar-grid');
    if (grid) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDow = firstDay.getDay();
        let html = '';
        for (let i = 0; i < startDow; i++) html += `<div></div>`;
        const today = new Date(); today.setHours(0,0,0,0);
        for (let d = 1; d <= lastDay.getDate(); d++) {
            const date = new Date(year, month, d);
            const wid = getWeekId(date);
            const isToday = date.getTime() === today.getTime();
            const isCurrent = wid === S.currentWeekId;
            html += `<button onclick="navigateToWeek('${wid}')" class="text-[10px] py-0.5 rounded transition-colors ${isToday ? 'bg-teal-500 text-white font-bold' : isCurrent ? 'bg-teal-100 text-teal-700 font-bold' : 'hover:bg-slate-100 text-slate-600'}">${d}</button>`;
        }
        grid.innerHTML = html;
    }

    const weekList = document.getElementById('left-nav-week-list');
    if (weekList) {
        const weeks = getWeeksInMonth(year, month);
        weekList.innerHTML = weeks.map(wid => {
            const { start, end } = getWeekDateRange(wid);
            const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
            const isCurrent = wid === S.currentWeekId;
            return `<button onclick="navigateToWeek('${wid}')" class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${isCurrent ? 'bg-teal-500 text-white font-bold' : 'hover:bg-slate-100 text-slate-700'}">
                <div class="font-bold">${formatWeekLabel(wid)}</div>
                <div class="text-[10px] ${isCurrent ? 'text-teal-100' : 'text-slate-400'}">${fmt(start)} ~ ${fmt(end)}</div>
            </button>`;
        }).join('');
    }

    lucide.createIcons();
}

function navigateToWeek(weekId) {
    S.currentWeekId = weekId;
    const weekEl = document.getElementById('week-display');
    if (weekEl) weekEl.textContent = formatWeekLabel(S.currentWeekId);
    const { start } = getWeekDateRange(weekId);
    leftNavMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    clearAllSubscriptions();
    subscribeToReservations();
    subscribeToFixedSchedules();
    subscribeToActivityLogs();
    subscribeRoomBlocks();
    renderDayTabs();
    renderLeftNav();
    // 모바일에서 주차 선택 시 플로팅 캘린더 닫기
    if (window.innerWidth < 1280) closeLeftNavOverlay();
}
window.navigateToWeek = navigateToWeek;

function setupLeftNav() {
    leftNavMonth = new Date();
    renderLeftNav();

    document.getElementById('left-nav-prev-month')?.addEventListener('click', () => {
        leftNavMonth.setMonth(leftNavMonth.getMonth() - 1);
        renderLeftNav();
    });
    document.getElementById('left-nav-next-month')?.addEventListener('click', () => {
        leftNavMonth.setMonth(leftNavMonth.getMonth() + 1);
        renderLeftNav();
    });

    let _lnavToggleLock = 0;
    document.getElementById('btn-left-nav-toggle')?.addEventListener('click', () => {
        const sidebar = document.getElementById('left-nav-sidebar');
        if (!sidebar) return;
        // 모바일 터치+클릭 중복 발생 방지(ghost click): 400ms 내 재호출 무시
        const now = Date.now();
        if (now - _lnavToggleLock < 400) return;
        _lnavToggleLock = now;
        // 결정적 토글: 현재 표시 여부를 읽어 명시적으로 열기/닫기
        if (sidebar.classList.contains('hidden')) openLeftNavOverlay();
        else closeLeftNavOverlay();
    });
}

// 모바일/태블릿(<1280px)에서는 좌측 캘린더를 플로팅 오버레이로 띄워 확실히 보이게 한다.
function openLeftNavOverlay() {
    const sidebar = document.getElementById('left-nav-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    sidebar.classList.add('flex');
    if (window.innerWidth < 1280) {
        Object.assign(sidebar.style, {
            position: 'fixed', top: '60px', left: '10px', right: 'auto', width: '15rem',
            zIndex: '95', maxHeight: '80vh', overflowY: 'auto',
            background: '#fff', borderRadius: '16px',
            boxShadow: '0 14px 44px rgba(15,23,42,.22)', padding: '12px',
        });
        let bd = document.getElementById('lnav-backdrop');
        if (!bd) {
            bd = document.createElement('div');
            bd.id = 'lnav-backdrop';
            Object.assign(bd.style, { position: 'fixed', inset: '0', zIndex: '94', background: 'rgba(15,23,42,.35)' });
            bd.addEventListener('click', closeLeftNavOverlay);
            document.body.appendChild(bd);
        }
        bd.style.display = 'block';
    }
}

function closeLeftNavOverlay() {
    const sidebar = document.getElementById('left-nav-sidebar');
    if (!sidebar) return;
    sidebar.classList.add('hidden');
    sidebar.classList.remove('flex');
    sidebar.removeAttribute('style');
    const bd = document.getElementById('lnav-backdrop');
    if (bd) bd.style.display = 'none';
}

// ==================== SIDE TABS ====================
function setupSideTabs() {
    const tabs = [
        { tab: 'tab-teams', panel: 'panel-teams' },
        { tab: 'tab-admin-side', panel: 'panel-admin-side' },
        { tab: 'tab-logs-side', panel: 'panel-logs-side' },
    ];
    tabs.forEach(({ tab, panel }, i) => {
        const btn = document.getElementById(tab);
        if (!btn) return;
        btn.addEventListener('click', () => {
            tabs.forEach(({ tab: t, panel: p }, j) => {
                const tb = document.getElementById(t), pb = document.getElementById(p);
                if (!tb || !pb) return;
                if (j === i) { tb.classList.add('border-teal-500', 'text-teal-600'); tb.classList.remove('border-transparent', 'text-slate-500'); pb.classList.remove('hidden'); }
                else { tb.classList.remove('border-teal-500', 'text-teal-600'); tb.classList.add('border-transparent', 'text-slate-500'); pb.classList.add('hidden'); }
            });
            if (tab === 'tab-logs-side') renderSideLogs();
        });
    });
}

// ==================== FIXED SCHEDULE FORM ====================
function setupFixedForm() {
    const form = document.getElementById('fixed-schedule-form');
    if (!form) return;
    const teamSel = document.getElementById('fs-team');
    const daySel = document.getElementById('fs-day');
    const startSel = document.getElementById('fs-start-hour');
    const endSel = document.getElementById('fs-end-hour');
    const roomSel = document.getElementById('fs-room');
    S.TEAMS.forEach(t => teamSel.appendChild(new Option(t.name, t.id)));
    DAYS.forEach(d => daySel.appendChild(new Option(d.fullLabel, d.id)));
    HOURS.forEach(h => { startSel.appendChild(new Option(h, h)); endSel.appendChild(new Option(h, h)); });
    startSel.value = '14:00'; endSel.value = '17:00';
    daySel.value = 'sat';
    ALL_ROOMS.forEach(r => roomSel.appendChild(new Option(r, r)));
    form.addEventListener('submit', async e => {
        e.preventDefault();
        await addFixedScheduleRange({ teamId: teamSel.value, day: daySel.value, room: roomSel.value, startHour: startSel.value, endHour: endSel.value, note: document.getElementById('fs-note').value });
        form.reset(); startSel.value = '14:00'; endSel.value = '17:00'; hideModal('fixed-schedule-modal');
    });
}


export { getWeekDateRange, getWeeksInMonth, renderLeftNav, navigateToWeek, setupLeftNav, setupSideTabs, setupFixedForm };
