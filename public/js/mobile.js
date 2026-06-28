import S from './state.js';
import { HOURS, FLOORS } from './constants.js';
import { getTeam, isAdmin, esc } from './utils.js';
import { renderTeamSelectors, renderSideLogs } from './render.js';

// ==================== MOBILE DRAWER ====================
function openMobileDrawer(tab = 'teams') {
    const overlay = document.getElementById('mobile-drawer-overlay');
    const drawer = document.getElementById('mobile-drawer');
    overlay?.classList.remove('hidden');
    drawer?.classList.remove('hidden');
    switchMobileDrawerTab(tab);
    if (tab === 'logs') renderMobileLogs();
    lucide.createIcons();
}
window.openMobileDrawer = openMobileDrawer;

function closeMobileDrawer() {
    document.getElementById('mobile-drawer-overlay')?.classList.add('hidden');
    document.getElementById('mobile-drawer')?.classList.add('hidden');
}
window.closeMobileDrawer = closeMobileDrawer;

function switchMobileDrawerTab(tab) {
    ['teams', 'admin', 'logs'].forEach(t => {
        const panel = document.getElementById(`mobile-panel-${t}`);
        const btn = document.getElementById(`mobile-dtab-${t}`);
        if (panel) panel.classList.toggle('hidden', t !== tab);
        if (btn) {
            if (t === tab) { btn.className = btn.className.replace('bg-slate-100 text-slate-500', 'bg-teal-500 text-white'); }
            else { btn.className = btn.className.replace('bg-teal-500 text-white', 'bg-slate-100 text-slate-500'); }
        }
    });
}
window.switchMobileDrawerTab = switchMobileDrawerTab;

function renderMobileTeamSelectors() {
    const c = document.getElementById('mobile-team-selectors');
    if (!c) return;
    if (!S.currentUser) {
        c.innerHTML = `<div class="text-center py-8 text-slate-400"><i data-lucide="lock" class="w-8 h-8 mx-auto mb-2 opacity-30"></i><p class="text-xs font-medium">로그인 후 예약 가능합니다</p></div>`;
        lucide.createIcons(); return;
    }
    const teamsToShow = isAdmin() ? S.TEAMS : S.TEAMS.filter(t => (S.currentUser.allowedTeams || []).includes(t.id));
    c.innerHTML = '';
    teamsToShow.forEach(team => {
        const isSelected = S.selectedTeamId === team.id;
        const btn = document.createElement('button');
        btn.className = `w-full p-2.5 rounded-xl text-left border-2 transition-all ${team.bg} ${team.text} ${team.border} ${isSelected ? 'ring-2 ring-teal-500 ring-offset-1 shadow-sm' : 'hover:opacity-90'}`;
        btn.innerHTML = `<div class="flex items-center justify-between"><span class="text-xs font-bold">${esc(team.name)}</span>${isSelected ? '<i data-lucide="check-circle" class="w-3.5 h-3.5"></i>' : ''}</div>`;
        btn.addEventListener('click', () => {
            S.selectedTeamId = isSelected ? null : team.id;
            renderTeamSelectors();
            renderMobileTeamSelectors();
            updateMobileBottomBar();
            closeMobileDrawer();
        });
        c.appendChild(btn);
    });
    lucide.createIcons();
}

function renderMobileLogs() {
    const c = document.getElementById('mobile-logs-list');
    if (!c) return;
    renderSideLogs();
    const desktopLogs = document.getElementById('side-logs-list');
    if (desktopLogs) c.innerHTML = desktopLogs.innerHTML;
}

function updateMobileBottomBar() {
    const bar = document.getElementById('mobile-bottom-bar');
    const label = document.getElementById('mobile-bottom-team-label');
    const teamBar = document.getElementById('mobile-team-bar');
    const teamChip = document.getElementById('mobile-team-chip');
    if (!bar) return;

    const isMobile = window.innerWidth < 1024;
    bar.classList.toggle('hidden', !isMobile);

    if (label) {
        const team = S.selectedTeamId ? getTeam(S.selectedTeamId) : null;
        label.textContent = team ? team.name : '활동단 선택';
    }

    if (teamBar && teamChip) {
        const team = S.selectedTeamId ? getTeam(S.selectedTeamId) : null;
        if (team && isMobile) {
            teamChip.innerHTML = `<span class="text-xs font-bold px-2 py-0.5 rounded-lg ${team.bg} ${team.text}">${esc(team.name)}</span>`;
            teamBar.classList.remove('hidden');
        } else {
            teamChip.innerHTML = '';
            teamBar.classList.add('hidden');
        }
    }

    const mAdminSection = document.getElementById('mobile-admin-section');
    const mAdminLocked = document.getElementById('mobile-admin-locked');
    if (mAdminSection && mAdminLocked) {
        const admin = isAdmin();
        mAdminSection.classList.toggle('hidden', !admin);
        mAdminLocked.classList.toggle('hidden', admin);
    }
}


export { openMobileDrawer, closeMobileDrawer, switchMobileDrawerTab, renderMobileTeamSelectors, renderMobileLogs, updateMobileBottomBar };
