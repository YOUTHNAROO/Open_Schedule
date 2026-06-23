import S from './state.js';
import { db, collection, addDoc, serverTimestamp, query, orderBy, getDocs } from './firebase.js';
import { HOURS, DAYS, FLOORS, ALL_ROOMS } from './constants.js';
import { getWeekId, esc, getWeekDateRange, getWeeksInMonth } from './utils.js';
import { showToast } from './ui.js';

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
            const wNum = wid.split('-W')[1];
            return `<button onclick="navigateToWeek('${wid}')" class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${isCurrent ? 'bg-teal-500 text-white font-bold' : 'hover:bg-slate-100 text-slate-700'}">
                <div class="font-bold">${parseInt(wNum)}주차</div>
                <div class="text-[10px] ${isCurrent ? 'text-teal-100' : 'text-slate-400'}">${fmt(start)} ~ ${fmt(end)}</div>
            </button>`;
        }).join('');
    }

    lucide.createIcons();
}

function navigateToWeek(weekId) {
    S.currentWeekId = weekId;
    const weekEl = document.getElementById('week-display');
    if (weekEl) weekEl.textContent = S.currentWeekId;
    const { start } = getWeekDateRange(weekId);
    leftNavMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    clearAllSubscriptions();
    subscribeToReservations();
    subscribeToFixedSchedules();
    subscribeToActivityLogs();
    renderLeftNav();
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

    document.getElementById('btn-left-nav-toggle')?.addEventListener('click', () => {
        const sidebar = document.getElementById('left-nav-sidebar');
        if (!sidebar) return;
        const isHidden = sidebar.classList.contains('hidden');
        sidebar.classList.toggle('hidden', !isHidden);
        sidebar.classList.toggle('flex', isHidden);
    });
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
