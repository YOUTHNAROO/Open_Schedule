import { auth, onAuthStateChanged, signOut } from './firebase.js';
import { supabase, dbGet, dbInsert, dbDelete } from './supabase.js';
import S from './state.js';
import { HOURS, ALL_ROOMS, DAYS } from './constants.js';
import { esc, isAdmin, getTeam, formatWeekLabel } from './utils.js';
import { showToast, showModal, hideModal, showConfirm, fetchClientIP } from './ui.js';
import { loginUser, doLogout, updateHeader, switchLoginTab, handleRegister, handleRecovery1, handleRecovery2, handleRecovery3, handlePasswordChange, handleLoginSubmit, SECURITY_QUESTIONS, migrateLegacyUserToSupabase } from './auth.js';
import { initData, clearAllSubscriptions } from './data.js';
import { initOneSignal } from './push.js';
import { markAllNotifsRead, toggleNotifPanel } from './notifications.js';
import { renderTable, renderDayTabs, renderTeamSelectors, renderAdminSection, renderSideLogs, setLogFilter, switchDay, closeReservationDetails } from './render.js';
import { setupLeftNav, setupSideTabs, setupFixedForm, renderLeftNav } from './sidebar.js';
import { openMobileDrawer, closeMobileDrawer, switchMobileDrawerTab, renderMobileTeamSelectors, updateMobileBottomBar } from './mobile.js';
import { openArchiveViewer, loadArchiveData, exportCurrentExcel } from './archive.js';
import { weeklyReset } from './fixed.js';

// ==================== INIT ====================
async function initApp() {
    fetchClientIP(); // background

    const weekEl = document.getElementById('week-display');
    if (weekEl) weekEl.textContent = formatWeekLabel(S.currentWeekId);

    renderDayTabs();
    updateHeader();
    renderTeamSelectors();
    renderAdminSection();
    setupSideTabs();
    setupLeftNav();
    setupFixedForm();

    // Event listeners
    document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
    document.getElementById('close-login-modal')?.addEventListener('click', () => { if (S.currentUser) hideModal('login-modal'); });
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    // 보안 질문 옵션
    const secQEl = document.getElementById('reg-sec-q');
    if (secQEl) SECURITY_QUESTIONS.forEach(q => secQEl.appendChild(new Option(q, q)));
    // 전역 노출
    // 전역 노출 (HTML onclick 핸들러 및 모듈 간 참조용)
    window.hideModal = hideModal;
    window.showModal = showModal;
    window.switchLoginTab = switchLoginTab;
    window.handleRecovery1 = handleRecovery1;
    window.handleRecovery2 = handleRecovery2;
    window.handleRecovery3 = handleRecovery3;
    window.handlePasswordChange = handlePasswordChange;
    window.toggleNotifPanel = toggleNotifPanel;
    window.markAllNotifsRead = markAllNotifsRead;
    window.closeMobileDrawer = closeMobileDrawer;
    window.openMobileDrawer = openMobileDrawer;
    window.switchMobileDrawerTab = switchMobileDrawerTab;
    window.setLogFilter = setLogFilter;
    window.switchDay = switchDay;
    window.closeReservationDetails = closeReservationDetails;
    // data.js가 window.*로 참조하는 렌더 함수들
    window.renderTable = renderTable;
    window.renderTeamSelectors = renderTeamSelectors;
    window.renderSideLogs = renderSideLogs;
    window.renderLeftNav = renderLeftNav;
    window.renderMobileTeamSelectors = renderMobileTeamSelectors;
    window.renderRoomBlockList = renderRoomBlockList;
    window.subscribeToReservations = () => import('./data.js').then(m => m.subscribeToReservations());

    document.addEventListener('click', e => {
        const panel = document.getElementById('notif-panel');
        if (panel && !panel.classList.contains('hidden') && !panel.contains(e.target) && e.target.id !== 'notif-btn') {
            panel.classList.add('hidden');
        }
    });

    document.getElementById('btn-export')?.addEventListener('click', exportCurrentExcel);
    document.getElementById('btn-reset')?.addEventListener('click', weeklyReset);
    document.getElementById('btn-add-fixed')?.addEventListener('click', () => showModal('fixed-schedule-modal'));
    document.getElementById('btn-room-block')?.addEventListener('click', () => initRoomBlockModal());
    document.getElementById('rb-submit')?.addEventListener('click', async () => {
        const day = document.getElementById('rb-day')?.value;
        const room = document.getElementById('rb-room')?.value;
        const startHour = document.getElementById('rb-start')?.value;
        const endHour = document.getElementById('rb-end')?.value;
        const allowedTeamId = document.getElementById('rb-team')?.value;
        const note = document.getElementById('rb-note')?.value.trim() || '';
        if (!day || !room || !startHour || !endHour || !allowedTeamId) { showToast('모든 항목을 선택하세요.', 'error'); return; }
        if (parseInt(startHour) >= parseInt(endHour)) { showToast('종료 시간이 시작 시간보다 늦어야 합니다.', 'error'); return; }
        if (allowedTeamId === '__custom__' && !rbSelectedUsers.length) { showToast('허용할 사용자를 한 명 이상 추가하세요.', 'error'); return; }
        const btn = document.getElementById('rb-submit');
        btn.disabled = true;
        try {
            const extraData = { allowedTeamId, note };
            if (allowedTeamId === '__custom__') {
                extraData.allowedUserIds = rbSelectedUsers.map(u => u.id);
                extraData.allowedUserNames = rbSelectedUsers.map(u => u.displayName);
                const customLabel = document.getElementById('rb-custom-label')?.value.trim() || '';
                if (customLabel) extraData.customLabel = customLabel;
            }
            await dbInsert('room_blocks', {
                room, day,
                start_hour: startHour,
                end_hour: endHour,
                reason: note,
                allowed_teams: allowedTeamId !== '__custom__' ? [allowedTeamId] : [],
                blocked_by: S.currentUser.id,
                data: extraData,
            });
            showToast('전용 시간이 설정되었습니다.', 'success');
            document.getElementById('rb-note').value = '';
            if (document.getElementById('rb-custom-label')) document.getElementById('rb-custom-label').value = '';
            rbSelectedUsers = [];
            renderRbUserChips();
        } catch(e) { showToast('설정 실패: ' + e.message, 'error'); }
        finally { btn.disabled = false; }
    });
    document.getElementById('close-fixed-modal')?.addEventListener('click', () => hideModal('fixed-schedule-modal'));
    document.getElementById('btn-archive')?.addEventListener('click', openArchiveViewer);
    document.getElementById('close-archive-modal')?.addEventListener('click', () => hideModal('archive-modal'));
    document.getElementById('archive-week-sel')?.addEventListener('change', e => { if (e.target.value) loadArchiveData(e.target.value); });

    // Firebase Auth 상태 리스너 (세션 관리용)
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                // Supabase에서 유저 데이터 조회
                let userRow = await dbGet('app_users', { id: user.uid });

                // 최초 주관리자 계정 폴백
                if (!userRow && user.email === 'admin@youthnaroo.local') {
                    await dbInsert('app_users', {
                        id: user.uid,
                        email: user.email,
                        username: 'admin',
                        display_name: '시스템관리자',
                        name: '시스템관리자',
                        role: 'superadmin',
                        allowed_teams: [],
                        is_active: true,
                        created_by: 'system',
                        data: {},
                    });
                    userRow = await dbGet('app_users', { id: user.uid });
                }

                // Bug 3 fix: 세션 복원 시에도 레거시 Firestore 사용자 자동 이관 (기존엔 loginUser에서만 처리)
                if (!userRow) {
                    try {
                        userRow = await migrateLegacyUserToSupabase(user.uid, user.email?.split('@')[0] || '', user.email || '');
                    } catch {}
                }

                if (userRow && userRow.is_active) {
                    S.currentUser = {
                        id: user.uid,
                        username: userRow.username,
                        displayName: userRow.display_name || userRow.name,
                        role: userRow.role,
                        allowedTeams: userRow.allowed_teams || [],
                        photoUrl: (userRow.data && userRow.data.photoUrl) || null,
                    };

                    if (!isAdmin() && (S.currentUser.allowedTeams || []).length > 0) {
                        S.selectedTeamId = S.currentUser.allowedTeams[0];
                    } else if (isAdmin()) {
                        S.selectedTeamId = S.TEAMS[0]?.id || null;
                    }

                    hideModal('login-modal');
                    updateHeader();
                    renderTeamSelectors();
                    renderAdminSection();
                    renderMobileTeamSelectors(); updateMobileBottomBar();

                    // 태그 기능용 사용자 목록 로드 (Supabase)
                    supabase.from('app_users').select('id, username, display_name, name').then(({ data }) => {
                        S.USERS_CACHE = (data || []).map(r => ({
                            id: r.id,
                            username: r.username,
                            displayName: r.display_name || r.name,
                        }));
                    }).catch(() => {});

                    // OneSignal 초기화
                    initOneSignal();

                    try {
                        await initData();
                    } catch (err) {
                        console.error('데이터 구독 실패:', err);
                    }
                    renderTable();
                } else {
                    await signOut(auth);
                    S.currentUser = null;
                    clearAllSubscriptions();
                    updateHeader();
                    showModal('login-modal');
                }
            } catch (e) {
                console.error('인증 정보 로드 에러:', e);
                await signOut(auth);
                S.currentUser = null;
                clearAllSubscriptions();
                updateHeader();
                showModal('login-modal');
            }
        } else {
            S.currentUser = null;
            S.selectedTeamId = null;
            clearAllSubscriptions();
            showModal('login-modal'); // 먼저 로그인 화면을 띄워 빈 화면 방지
            try {
                updateHeader();
                renderTeamSelectors();
                renderAdminSection();
                renderTable();
                renderMobileTeamSelectors(); updateMobileBottomBar();
            } catch (e) { console.error('로그아웃 화면 렌더 에러:', e); }
        }
    });

    initMobileAdmin();
    lucide.createIcons();
}

// 기타 전용: 선택된 사용자 목록
let rbSelectedUsers = [];

function initRoomBlockModal() {
    rbSelectedUsers = [];

    const roomSel = document.getElementById('rb-room');
    if (roomSel && roomSel.options.length === 0) ALL_ROOMS.forEach(r => roomSel.appendChild(new Option(r, r)));
    const startSel = document.getElementById('rb-start');
    const endSel = document.getElementById('rb-end');
    if (startSel && startSel.options.length === 0) HOURS.forEach(h => startSel.appendChild(new Option(h, h)));
    if (endSel && endSel.options.length === 0) { for (let h = 10; h <= 22; h++) { const hStr = `${String(h).padStart(2,'0')}:00`; endSel.appendChild(new Option(hStr, hStr)); } endSel.value = '22:00'; }

    const teamSel = document.getElementById('rb-team');
    teamSel.innerHTML = '<option value="__custom__">기타 (특정 사용자 지정)</option>';
    S.TEAMS.forEach(t => teamSel.appendChild(new Option(t.name, t.id)));
    teamSel.value = S.TEAMS[0]?.id || '__custom__';

    const customWrap = document.getElementById('rb-custom-users-wrap');
    const toggleCustom = () => { const isCustom = teamSel.value === '__custom__'; customWrap?.classList.toggle('hidden', !isCustom); };
    teamSel.removeEventListener('change', teamSel._rbToggle);
    teamSel._rbToggle = toggleCustom;
    teamSel.addEventListener('change', toggleCustom);
    toggleCustom();

    const searchInput = document.getElementById('rb-user-search');
    const dropdown = document.getElementById('rb-user-dropdown');
    if (searchInput) {
        searchInput.value = '';
        const onSearch = () => {
            const q = searchInput.value.toLowerCase().trim();
            if (!q) { dropdown.classList.add('hidden'); return; }
            const hits = S.USERS_CACHE.filter(u =>
                !rbSelectedUsers.find(s => s.id === u.id) &&
                ((u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q))
            ).slice(0, 6);
            if (!hits.length) { dropdown.classList.add('hidden'); return; }
            dropdown.innerHTML = hits.map(u =>
                `<div class="rb-user-opt flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-purple-50" data-id="${esc(u.id)}" data-name="${esc(u.displayName)}" data-un="${esc(u.username)}">
                    <span class="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0">${esc((u.displayName||'?')[0])}</span>
                    <span class="text-sm font-semibold text-slate-800">${esc(u.displayName)}</span>
                    <span class="text-xs text-slate-400 ml-auto">@${esc(u.username)}</span>
                </div>`
            ).join('');
            dropdown.classList.remove('hidden');
            dropdown.querySelectorAll('.rb-user-opt').forEach(opt => {
                opt.addEventListener('mousedown', e => {
                    e.preventDefault();
                    rbSelectedUsers.push({ id: opt.dataset.id, displayName: opt.dataset.name, username: opt.dataset.un });
                    searchInput.value = '';
                    dropdown.classList.add('hidden');
                    renderRbUserChips();
                });
            });
        };
        searchInput.removeEventListener('input', searchInput._rbSearch);
        searchInput._rbSearch = onSearch;
        searchInput.addEventListener('input', onSearch);
        searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
    }

    const daySel = document.getElementById('rb-day');
    if (daySel) daySel.value = S.activeDay;

    renderRbUserChips();
    renderRoomBlockList();
    showModal('room-block-modal');
    lucide.createIcons();
}

function renderRbUserChips() {
    const chips = document.getElementById('rb-user-chips');
    if (!chips) return;
    if (!rbSelectedUsers.length) { chips.innerHTML = `<span class="text-[10px] text-purple-400">추가한 사용자가 여기에 표시됩니다</span>`; return; }
    chips.innerHTML = rbSelectedUsers.map(u =>
        `<span class="flex items-center gap-1 bg-purple-100 text-purple-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
            ${esc(u.displayName)}
            <button type="button" onclick="rbRemoveUser('${esc(u.id)}')" class="ml-0.5 text-purple-400 hover:text-red-500 leading-none">×</button>
        </span>`
    ).join('');
}

window.rbRemoveUser = (uid) => { rbSelectedUsers = rbSelectedUsers.filter(u => u.id !== uid); renderRbUserChips(); };

function renderRoomBlockList() {
    const list = document.getElementById('rb-list');
    if (!list) return;
    if (!S.roomBlocks.length) { list.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">설정된 전용 시간이 없습니다.</p>`; return; }
    const dayLabel = { mon:'월', tue:'화', wed:'수', thu:'목', fri:'금', sat:'토', sun:'일' };
    list.innerHTML = S.roomBlocks.map(b => {
        const isCustom = b.allowedTeamId === '__custom__';
        const team = isCustom ? null : getTeam(b.allowedTeamId);
        let whoLabel;
        if (isCustom) {
            const names = (b.allowedUserIds || []).map(uid => { const u = S.USERS_CACHE.find(x => x.id === uid); return u ? u.displayName : uid; }).join(', ');
            const labelPrefix = b.customLabel ? `${b.customLabel} (기타)` : '기타';
            whoLabel = `${labelPrefix}: ${names || '사용자 없음'}`;
        } else {
            whoLabel = (team?.name || b.allowedTeamId) + ' 전용';
        }
        return `<div class="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-lg px-2.5 py-2">
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold text-purple-800 truncate">${esc(dayLabel[b.day]||b.day)} · ${esc(b.room)} · ${esc(b.startHour)}~${esc(b.endHour)}</p>
                <p class="text-[10px] text-purple-600 truncate">${esc(whoLabel)}${b.note ? ` · ${esc(b.note)}` : ''}</p>
            </div>
            <button onclick="deleteRoomBlock('${esc(b.id)}')" class="p-1 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0 transition-colors"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
        </div>`;
    }).join('');
    lucide.createIcons();
}

window.deleteRoomBlock = async (blockId) => {
    const ok = await showConfirm('이 전용 시간 설정을 삭제하시겠습니까?', { title: '전용 시간 삭제', okText: '삭제', danger: true });
    if (!ok) return;
    try {
        await dbDelete('room_blocks', { id: blockId });
        showToast('전용 시간이 삭제되었습니다.', 'success');
    } catch(e) { showToast('삭제 실패: ' + e.message, 'error'); }
};

function initMobileAdmin() {
    document.getElementById('mobile-btn-add-fixed')?.addEventListener('click', () => { closeMobileDrawer(); document.getElementById('btn-add-fixed')?.click(); });
    document.getElementById('mobile-btn-reset')?.addEventListener('click', () => { closeMobileDrawer(); weeklyReset(); });
    document.getElementById('mobile-team-change-btn')?.addEventListener('click', () => openMobileDrawer('teams'));
    document.getElementById('mobile-btn-archive')?.addEventListener('click', () => document.getElementById('btn-archive')?.click());
    document.getElementById('mobile-btn-export')?.addEventListener('click', () => document.getElementById('btn-export')?.click());
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
