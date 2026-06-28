import S from './state.js';
import { HOURS, FLOORS, ALL_ROOMS, DAYS } from './constants.js';
import { esc, getTeam, isAdmin, normalizeColor, getTextColorForBg, getWeekId, getWeekDateRange } from './utils.js';
import { showToast, showModal, hideModal, showConfirm, formatTime, renderTagged, setupPersonTagInput, setupTagInput, expandHourRange } from './ui.js';
import { updateReservationDetails, cancelReservation, addComment, openBookingModal, showRangeReserveModal, makeReservation } from './reservations.js';
import { addActivityLog } from './logging.js';
import { syncGoogleSheets } from './sheets.js';
import { supabase } from './supabase.js';
import { getRoomBlock } from './data.js';

// ==================== RENDER ====================
function renderDayTabs() {
    const c = document.getElementById('day-tabs');
    if (!c) return;
    c.innerHTML = '';
    const { start } = getWeekDateRange(S.currentWeekId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    DAYS.forEach((day, idx) => {
        const dayDate = new Date(start);
        dayDate.setDate(start.getDate() + idx);
        const dateStr = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;
        const isToday = dayDate.getTime() === today.getTime();
        const isActive = day.id === S.activeDay;
        const btn = document.createElement('button');
        btn.className = `flex-1 min-w-[44px] py-2 px-1 rounded-xl text-xs font-bold transition-all duration-200 flex flex-col items-center gap-0.5 ${isActive ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`;
        btn.innerHTML = `<span class="text-[9px] font-semibold ${isToday ? (isActive ? 'text-teal-500' : 'text-teal-400') : 'opacity-40 font-normal'}">${dateStr}</span><span>${day.label}</span>`;
        btn.addEventListener('click', () => switchDay(day.id));
        c.appendChild(btn);
    });
}

function renderTeamSelectors() {
    const c = document.getElementById('team-selectors');
    if (!c) return;
    if (!S.currentUser) {
        c.innerHTML = `<div class="text-center py-8 text-slate-400"><i data-lucide="lock" class="w-8 h-8 mx-auto mb-2 opacity-30"></i><p class="text-xs font-medium">로그인 후 예약 가능합니다</p></div>`;
        lucide.createIcons(); return;
    }
    const teamsToShow = isAdmin() ? S.TEAMS : S.TEAMS.filter(t => (S.currentUser.allowedTeams || []).includes(t.id));
    if (teamsToShow.length === 0) {
        c.innerHTML = `<div class="text-center py-8 text-slate-400"><i data-lucide="users-x" class="w-8 h-8 mx-auto mb-2 opacity-30"></i><p class="text-xs">배정된 활동단이 없습니다.</p><p class="text-xs mt-1 text-slate-300">관리자에게 문의하세요.</p></div>`;
        lucide.createIcons(); return;
    }
    c.innerHTML = '';
    teamsToShow.forEach(team => {
        const isSelected = S.selectedTeamId === team.id;
        const btn = document.createElement('button');
        btn.className = `w-full p-2.5 rounded-xl text-left border-2 transition-all flex flex-col gap-1 ${team.bg} ${team.text} ${team.border} ${isSelected ? 'ring-2 ring-teal-500 ring-offset-1 shadow-sm' : 'hover:opacity-90'}`;
        const tags = (team.typicalRooms || []).slice(0, 2).map(r => `<span class="bg-white/60 text-[9px] px-1.5 py-0.5 rounded font-medium">${r}</span>`).join('');
        btn.innerHTML = `
            <div class="flex items-start justify-between gap-1">
                <div class="min-w-0"><div class="text-[9px] font-bold opacity-50 truncate">${team.fullType}</div><div class="text-xs font-bold truncate">${team.name}</div></div>
                ${isSelected ? '<i data-lucide="check-circle" class="w-3.5 h-3.5 flex-shrink-0 mt-0.5"></i>' : ''}
            </div>
            ${team.schedule ? `<div class="flex items-center gap-1 text-[10px] opacity-70"><i data-lucide="clock" class="w-2.5 h-2.5 flex-shrink-0"></i><span class="truncate">${team.schedule}</span></div>` : ''}
            ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
        `;
        btn.addEventListener('click', () => { S.selectedTeamId = team.id; renderTeamSelectors(); lucide.createIcons(); });
        c.appendChild(btn);
    });
    if (teamsToShow.length === 1 && !S.selectedTeamId) { S.selectedTeamId = teamsToShow[0].id; renderTeamSelectors(); return; }
    lucide.createIcons();
    renderTeamColorLegend();
}

function renderTeamColorLegend() {
    const c = document.getElementById('team-color-legend');
    if (!c) return;
    c.innerHTML = S.TEAMS.map(t => {
        const dotCls = t.bg.replace('bg-', 'bg-').replace('-100', '-400');
        return `<div class="flex items-center gap-1.5 ${t.bg} ${t.border} border rounded-lg px-2 py-1 overflow-hidden">
            <span class="w-2 h-2 rounded-full ${dotCls} shrink-0"></span>
            <span class="text-[9px] font-bold ${t.text} truncate min-w-0">${esc(t.name)}</span>
        </div>`;
    }).join('');
}

function renderTableHeader() {
    const head = document.getElementById('schedule-head');
    if (!head) return;
    head.innerHTML = `
        <tr class="border-b border-slate-200">
            <th class="py-2 px-3 text-center text-[10px] font-bold text-slate-400 border-r border-slate-200 w-16 bg-slate-50">시간</th>
            ${FLOORS.map(floor => `<th colspan="${floor.rooms.length}" class="py-2 px-3 text-center text-[10px] font-bold text-slate-700 border-r-2 border-slate-300 bg-slate-50/90">${esc(floor.label)}</th>`).join('')}
        </tr>
        <tr class="bg-slate-50 border-b-2 border-slate-200 text-center">
            <th class="py-2 px-1 text-[10px] font-bold text-slate-400 border-r border-slate-200 bg-slate-100 w-16">구분</th>
            ${FLOORS.flatMap(floor => floor.rooms.map((room, idx) => {
                const isLast = idx === floor.rooms.length - 1;
                return `<th class="py-2 px-1 text-[10px] font-bold text-slate-600 whitespace-nowrap ${isLast ? 'border-r-2 border-slate-300' : 'border-r border-slate-100'} bg-slate-50 min-w-[110px]">${esc(room)}</th>`;
            })).join('')}
        </tr>
    `;
}

function getReservationCardStyle(res, team) {
    // 관리자가 수동 지정한 시트색상 최우선
    const sheetColor = normalizeColor(res?.sheetColor);
    if (sheetColor) {
        const textColor = getTextColorForBg(sheetColor);
        return { className: 'border-slate-200', style: `background:${sheetColor};border-color:${sheetColor};color:${textColor};` };
    }
    if (team) {
        // Firestore color 필드 → DEFAULT_TEAMS hex → CSS 클래스 순서로 적용
        const teamHex = normalizeColor(team.color) || normalizeColor(team.hex);
        if (teamHex) {
            const textColor = team.hexText || getTextColorForBg(teamHex);
            return { className: 'border-slate-200', style: `background:${teamHex};border-color:${teamHex};color:${textColor};` };
        }
        if (team.bg) {
            return { className: `${team.bg} ${team.text} ${team.border}`, style: '' };
        }
    }
    return { className: 'bg-slate-50 text-slate-500 border-slate-200', style: '' };
}

function getReservationByContext(hour, room) {
    const key = `${hour}-${room}`.replace(/\//g, '_');
    return { key, res: S.reservations[key] || null };
}

function canEditReservation(res) {
    return !!(S.currentUser && res && (isAdmin() || (S.currentUser.allowedTeams || []).includes(res.teamId)) && (!res.isFixed || isAdmin()));
}

function openReservationDetails(hour, room) {
    const { key, res } = getReservationByContext(hour, room);
    if (!res) return;
    S.selectedReservationContext = { hour, room, key };
    renderReservationDetails();
    showModal('reservation-detail-drawer');
}

function closeReservationDetails() {
    S.selectedReservationContext = null;
    hideModal('reservation-detail-drawer');
}

function renderReservationDetails() {
    const content = document.getElementById('reservation-detail-content');
    if (!content) return;
    if (!S.selectedReservationContext) {
        content.innerHTML = '';
        return;
    }
    const { hour, room, key } = S.selectedReservationContext;
    const res = S.reservations[key];
    if (!res) {
        content.innerHTML = `<div class="p-5 text-sm text-slate-500">예약이 삭제되었습니다.</div>`;
        return;
    }
    const team = getTeam(res.teamId);
    const admin = isAdmin();
    const isOwner = S.currentUser && S.currentUser.id === res.userId;
    const isTeamMember = S.currentUser && (S.currentUser.allowedTeams || []).includes(res.teamId);
    const fullEditable = admin && !res.isFixed;
    const noteEditable = (admin || isOwner || isTeamMember) && !res.isFixed;
    const cancellable = canEditReservation(res);
    const sheetColor = normalizeColor(res.sheetColor);
    const _localTeamId = team ? team.id : 'external';
    const teamOptions = [
        `<option value="external" ${_localTeamId === 'external' ? 'selected' : ''}>직접 입력 / 외부 예약</option>`,
        ...S.TEAMS.map(t => `<option value="${esc(t.id)}" ${_localTeamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`)
    ].join('');

    // 신청자 정보 (관리자만)
    const applicantUser = admin && res.userId ? S.USERS_CACHE.find(u => u.id === res.userId) : null;
    const applicantBlock = admin && applicantUser ? `
        <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p class="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wide">신청자</p>
            <div class="flex items-center gap-2.5">
                <span class="w-8 h-8 rounded-full bg-teal-100 text-teal-700 text-sm font-bold flex items-center justify-center shrink-0">${esc((applicantUser.displayName||'?')[0])}</span>
                <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-800 leading-tight">${esc(applicantUser.displayName || applicantUser.username)}</p>
                    <p class="text-[11px] text-slate-400">@${esc(applicantUser.username || '')}</p>
                    ${applicantUser.phone ? `<p class="text-[11px] text-teal-600 font-mono mt-0.5">${esc(applicantUser.phone)}</p>` : ''}
                </div>
            </div>
        </div>` : '';

    const isPendingRes = res.status === 'pending';
    const pendingBanner = isPendingRes ? `
        <div class="mx-5 mt-5 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
            <div class="flex items-center gap-2 mb-1">
                <i data-lucide="hourglass" class="w-4 h-4 text-orange-500 shrink-0"></i>
                <span class="text-sm font-bold text-orange-700">담당자 승인 대기 중</span>
            </div>
            <p class="text-xs text-orange-500 mb-3">관리자 승인 후 예약이 확정됩니다.</p>
            ${admin ? `<div class="flex gap-2">
                <button onclick="approvePendingFromDetail('${hour}','${room}','${key}')" class="flex-1 py-2 bg-teal-600 text-white text-xs font-bold rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center gap-1.5">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i> 승인
                </button>
                <button onclick="rejectPendingFromDetail('${hour}','${room}','${key}')" class="flex-1 py-2 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center gap-1.5">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i> 거절
                </button>
            </div>` : ''}
        </div>` : '';
    content.innerHTML = `
        ${pendingBanner}
        <div class="p-5 border-b border-slate-100">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                    <p class="text-[11px] font-bold text-teal-600 mb-1">${DAYS.find(d => d.id === S.activeDay)?.fullLabel || S.activeDay} · ${esc(hour)} · ${esc(room)}</p>
                    <h2 class="text-lg font-black text-slate-900 leading-tight">${esc(res.teamName || '예약')}</h2>
                    <p class="text-xs text-slate-400 mt-1">${res.isFixed ? '고정 일정' : '일반 예약'}${res.userName ? ` · 담당: ${esc(res.userName)}` : ''}</p>
                    ${applicantBlock}
                </div>
                <button id="reservation-detail-close" class="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0" title="닫기">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
            ${sheetColor ? `<div class="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span class="w-5 h-5 rounded border border-slate-300" style="background:${sheetColor}"></span>
                <div>
                    <div class="text-[11px] font-bold text-slate-700">시트 색상</div>
                    <div class="text-[10px] text-slate-400">${sheetColor}${res.sheetOwner ? ` · ${esc(res.sheetOwner)}` : ''}</div>
                </div>
            </div>` : ''}
        </div>
        <div class="p-5 space-y-4">
            ${fullEditable ? `
            <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">수업 변경</label>
                <select id="detail-team" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                    ${teamOptions}
                </select>
            </div>
            <div id="detail-team-custom-wrap" class="${S.selectedTeamId === 'external' ? '' : 'hidden'}">
                <label class="block text-xs font-bold text-slate-600 mb-1.5">수업명 직접 입력</label>
                <input id="detail-team-custom" value="${esc(team ? '' : res.teamName || '')}" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400">
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">담당자 변경</label>
                <div class="relative">
                    <input id="detail-user-name" value="${esc(res.userName || '')}" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400" placeholder="담당자 이름 또는 @아이디">
                </div>
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">시트 색상</label>
                <div class="flex items-center gap-2 mb-2">
                    <input type="color" id="detail-sheet-color-picker" value="${sheetColor || '#ffffff'}" class="w-9 h-9 rounded border border-slate-200 cursor-pointer p-0.5">
                    <input id="detail-sheet-color-hex" value="${sheetColor || ''}" placeholder="#없음 (색상 없음)" maxlength="7" class="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 font-mono">
                    <button id="detail-sheet-color-clear" type="button" class="px-2.5 py-2 text-xs text-slate-400 hover:text-red-500 border border-slate-200 rounded-lg hover:border-red-200 transition-colors" title="색상 제거">✕</button>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${S.TEAMS.filter(t => t.hex).map(t => `<button type="button" class="color-palette-swatch w-6 h-6 rounded-full border-2 hover:scale-125 transition-transform cursor-pointer shrink-0 ${sheetColor === t.hex ? 'border-slate-500 scale-110' : 'border-white shadow'}" style="background:${t.hex}" data-hex="${t.hex}" title="${esc(t.name)}"></button>`).join('')}
                    ${['#f1f5f9','#e2e8f0','#94a3b8','#475569','#1e293b'].map(hex => `<button type="button" class="color-palette-swatch w-6 h-6 rounded-full border-2 hover:scale-125 transition-transform cursor-pointer shrink-0 ${sheetColor === hex ? 'border-slate-500 scale-110' : 'border-white shadow'}" style="background:${hex}" data-hex="${hex}" title="${hex}"></button>`).join('')}
                </div>
            </div>` : ''}
            <div>
                <label class="block text-xs font-bold text-slate-600 mb-1.5">메모</label>
                <div class="relative">
                    <textarea id="detail-note" ${noteEditable ? '' : 'disabled'} rows="3" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none disabled:bg-slate-50 disabled:text-slate-400" placeholder="예약 관련 메모 (@로 태그)">${esc(res.note || '')}</textarea>
                </div>
            </div>
            ${res.isFixed ? `<div class="rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-xs px-3 py-2">고정 일정은 관리자 고정 일정 메뉴에서 수정할 수 있습니다.</div>` : ''}
        </div>
        <div class="p-5 border-t border-slate-100 bg-slate-50 flex gap-2">
            <button id="reservation-detail-save" ${noteEditable ? '' : 'disabled'} class="flex-1 py-2.5 rounded-lg text-sm font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors flex items-center justify-center gap-1.5">
                <i data-lucide="save" class="w-4 h-4"></i> 저장
            </button>
            <button id="reservation-detail-cancel" ${cancellable ? '' : 'disabled'} class="px-4 py-2.5 rounded-lg text-sm font-bold bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-300 transition-colors flex items-center gap-1.5">
                <i data-lucide="trash-2" class="w-4 h-4"></i> 취소
            </button>
        </div>
        <div class="px-5 pb-5">
            <div class="flex items-center gap-2 mb-3">
                <i data-lucide="message-circle" class="w-3.5 h-3.5 text-slate-400"></i>
                <span class="text-xs font-bold text-slate-600">댓글</span>
                <span class="text-[10px] text-slate-400 ml-auto">${(res.comments || []).filter(c => !c.isLog).length}개</span>
            </div>
            <div id="detail-comments-list" class="space-y-2 mb-3 max-h-52 overflow-y-auto">
                ${(res.comments || []).length === 0
                    ? `<p class="text-xs text-slate-400 text-center py-3">아직 댓글이 없습니다.</p>`
                    : (res.comments || []).map(c => c.isLog
                        ? `<div class="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                            <i data-lucide="git-commit-horizontal" class="w-3 h-3 text-slate-400 mt-0.5 shrink-0"></i>
                            <div class="flex-1 min-w-0">
                                <span class="text-[10px] text-slate-500 leading-relaxed">${esc(c.text)}</span>
                                <span class="text-[9px] text-slate-400 ml-1.5">${esc(c.author)} · ${formatTime(c.createdAt)}</span>
                            </div>
                        </div>`
                        : `<div class="bg-white border border-slate-100 rounded-xl px-3 py-2.5 shadow-sm">
                            <div class="flex items-center gap-1.5 mb-1">
                                <span class="w-5 h-5 rounded-full bg-teal-100 text-teal-700 text-[9px] font-bold flex items-center justify-center shrink-0">${esc((c.author||'?')[0])}</span>
                                <span class="text-[11px] font-bold text-slate-700">${esc(c.author || '알 수 없음')}</span>
                                <span class="text-[9px] text-slate-400 ml-auto">${formatTime(c.createdAt)}</span>
                            </div>
                            <p class="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed pl-6">${renderTagged(esc(c.text || ''))}</p>
                        </div>`
                    ).join('')}
            </div>
            ${S.currentUser ? `
            <div class="flex gap-2 items-end">
                <div class="relative flex-1">
                    <textarea id="detail-comment-input" rows="2" placeholder="댓글 입력... (@로 태그)" class="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"></textarea>
                </div>
                <button id="detail-comment-submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl hover:bg-teal-700 transition-colors shrink-0 flex items-center gap-1">
                    <i data-lucide="send" class="w-3.5 h-3.5"></i>
                </button>
            </div>` : ''}
        </div>
    `;
    document.getElementById('reservation-detail-close')?.addEventListener('click', closeReservationDetails);
    document.getElementById('reservation-detail-save')?.addEventListener('click', updateReservationDetails);
    document.getElementById('reservation-detail-cancel')?.addEventListener('click', () => cancelReservation(hour, room));
    // 관리자 전용 필드 이벤트
    document.getElementById('detail-team')?.addEventListener('change', e => {
        document.getElementById('detail-team-custom-wrap')?.classList.toggle('hidden', e.target.value !== 'external');
    });
    document.getElementById('detail-sheet-color-picker')?.addEventListener('input', e => {
        const hex = document.getElementById('detail-sheet-color-hex');
        if (hex) hex.value = e.target.value;
    });
    document.getElementById('detail-sheet-color-hex')?.addEventListener('input', e => {
        const v = e.target.value.trim();
        if (isValidHexColor(v)) {
            const picker = document.getElementById('detail-sheet-color-picker');
            if (picker) picker.value = v;
        }
    });
    document.getElementById('detail-sheet-color-clear')?.addEventListener('click', () => {
        const hex = document.getElementById('detail-sheet-color-hex');
        const picker = document.getElementById('detail-sheet-color-picker');
        if (hex) hex.value = '';
        if (picker) picker.value = '#ffffff';
        document.querySelectorAll('.color-palette-swatch').forEach(b => b.classList.replace('border-slate-500', 'border-white'));
    });
    document.querySelectorAll('.color-palette-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            const h = btn.dataset.hex;
            const hexInput = document.getElementById('detail-sheet-color-hex');
            const picker = document.getElementById('detail-sheet-color-picker');
            if (hexInput) hexInput.value = h;
            if (picker) picker.value = h;
            document.querySelectorAll('.color-palette-swatch').forEach(b => {
                b.classList.remove('border-slate-500', 'scale-110');
                b.classList.add('border-white');
            });
            btn.classList.remove('border-white');
            btn.classList.add('border-slate-500', 'scale-110');
        });
    });
    // 댓글 등록
    const commentInput = document.getElementById('detail-comment-input');
    document.getElementById('detail-comment-submit')?.addEventListener('click', async () => {
        const text = commentInput?.value || '';
        if (!text.trim()) return;
        const btn = document.getElementById('detail-comment-submit');
        btn.disabled = true;
        try {
            await addComment(key, text);
            commentInput.value = '';
        } catch(e) { showToast('댓글 등록 실패: ' + e.message, 'error'); }
        finally { btn.disabled = false; }
    });
    commentInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('detail-comment-submit')?.click(); }
    });
    setupPersonTagInput(document.getElementById('detail-user-name'));
    setupTagInput(document.getElementById('detail-note'));
    setupTagInput(document.getElementById('detail-comment-input'));
    lucide.createIcons();
}

function renderTable() {
    renderTableHeader();
    const body = document.getElementById('schedule-body');
    if (!body) return;
    body.innerHTML = '';

    // 연속 동일 팀 예약 셀 병합 사전 계산
    const cellSpan = {}; // key -> { rowspan: N } 또는 { skip: true }
    ALL_ROOMS.forEach(room => {
        let i = 0;
        while (i < HOURS.length) {
            const hour = HOURS[i];
            const key = `${hour}-${room}`.replace(/\//g, '_');
            const res = S.reservations[key];
            if (res) {
                let count = 1;
                while (i + count < HOURS.length) {
                    const nk = `${HOURS[i + count]}-${room}`.replace(/\//g, '_');
                    const nr = S.reservations[nk];
                    if (nr && nr.teamId === res.teamId && nr.teamName === res.teamName && nr.isFixed === res.isFixed) count++;
                    else break;
                }
                if (count > 1) {
                    cellSpan[key] = { rowspan: count };
                    for (let j = 1; j < count; j++) {
                        cellSpan[`${HOURS[i + j]}-${room}`.replace(/\//g, '_')] = { skip: true };
                    }
                }
                i += count;
            } else { i++; }
        }
    });

    HOURS.forEach(hour => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/30 transition-colors border-b border-slate-100';
        const timeTd = document.createElement('td');
        timeTd.className = 'py-3 px-2 text-center font-bold text-xs text-slate-500 bg-slate-50/80 border-r border-slate-200 w-16 sticky left-0 z-10';
        timeTd.textContent = hour;
        tr.appendChild(timeTd);
        ALL_ROOMS.forEach(room => {
            const floor = FLOORS.find(f => f.rooms.includes(room));
            const isLast = floor && floor.rooms[floor.rooms.length - 1] === room;
            const key = `${hour}-${room}`.replace(/\//g, '_');
            const span = cellSpan[key];
            if (span?.skip) return; // 병합된 셀은 건너뜀

            const td = document.createElement('td');
            td.className = `p-1 ${isLast ? 'border-r-2 border-slate-300' : 'border-r border-slate-100'} relative min-w-[110px]`;
            if (span?.rowspan > 1) {
                td.rowSpan = span.rowspan;
                td.style.verticalAlign = 'top';
            }
            const res = S.reservations[key];
            const isPending = res?.status === 'pending';
            if (res) {
                const team = getTeam(res.teamId);
                let displayName = res.lessonName || res.teamName;
                if (!res.lessonName) {
                    if (team && team.shortName) displayName = team.shortName;
                }
                const mergeCount = span?.rowspan || 1;
                const minH = `min-height:${mergeCount > 1 ? mergeCount * 54 - 4 : 46}px;`;
                const titleAttr = `${res.teamName}${res.isFixed ? ' [고정]' : ''}${res.strikethrough ? ' [예약중]' : ''}${isPending ? ' [승인대기]' : ''}\n분류: ${team ? (team.fullType || '활동단') : '기타(정규 시간표)'}\n예약자: ${res.userName || ''}${res.note ? `\n메모: ${res.note}` : ''}${res.sheetColor ? `\n시트색: ${res.sheetColor}` : ''}`;
                if (isPending) {
                    td.innerHTML = `<button type="button" onclick="openReservationDetails('${hour}','${room}')" class="w-full flex flex-col justify-center items-center px-0.5 py-1 rounded-lg border-2 border-dashed shadow-sm relative group transition-all hover:shadow-md hover:-translate-y-0.5 border-orange-300" style="background:#fff7ed;${minH}" title="${esc(titleAttr)}">
                        <span class="text-[9px] font-bold text-orange-500 flex items-center gap-0.5 leading-none mb-0.5"><i data-lucide="hourglass" class="w-2.5 h-2.5"></i> 승인 대기</span>
                        <span class="text-[10px] font-bold text-center w-full break-words leading-tight px-0.5 text-orange-700">${esc(displayName)}</span>
                        <span class="text-[9px] text-orange-400 mt-0.5 break-words w-full text-center px-0.5 leading-tight">${esc(res.userName || '')}</span>
                    </button>`;
                } else if (res.strikethrough) {
                    td.innerHTML = `<button type="button" onclick="openReservationDetails('${hour}','${room}')" class="w-full flex flex-col justify-center items-center px-0.5 py-1 rounded-lg border-2 shadow-sm relative group transition-all hover:shadow-md hover:-translate-y-0.5 border-amber-300" style="background:#fffbeb;${minH}" title="${esc(titleAttr)}">
                        <span class="text-[9px] font-bold text-amber-500 flex items-center gap-0.5 leading-none mb-0.5"><i data-lucide="clock" class="w-2.5 h-2.5"></i> 예약중</span>
                        <span class="text-[10px] font-bold text-center w-full break-words leading-tight px-0.5 line-through text-slate-400">${esc(displayName)}</span>
                        <span class="text-[9px] text-slate-300 mt-0.5 break-words w-full text-center px-0.5 leading-tight line-through">${esc(res.userName || '')}</span>
                        <span class="absolute bottom-0.5 right-1 opacity-0 group-hover:opacity-60 transition-opacity"><i data-lucide="settings-2" class="w-3 h-3 text-amber-400"></i></span>
                    </button>`;
                } else {
                const cardVisual = getReservationCardStyle(res, team);
                td.innerHTML = `<button type="button" onclick="openReservationDetails('${hour}','${room}')" class="w-full flex flex-col justify-center items-center px-0.5 py-1 rounded-lg border-2 shadow-sm relative group text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${cardVisual.className} ${res.isFixed ? 'ring-1 ring-current/20 shadow-md' : ''}" style="${cardVisual.style}${minH}" title="${esc(titleAttr)}">
                    <span class="absolute top-0.5 right-0.5 text-[9px] flex items-center gap-0.5 leading-none">
                        ${res.isFixed ? '🔒' : ''}
                        ${res.note ? '<i data-lucide="message-square" class="w-2.5 h-2.5 opacity-60"></i>' : ''}
                    </span>
                    <span class="text-[10px] font-bold text-center w-full break-words leading-tight px-0.5">${esc(displayName)}</span>
                    <span class="text-[9px] opacity-60 mt-0.5 break-words w-full text-center px-0.5 leading-tight">${esc(res.userName || '')}</span>
                    ${mergeCount > 1 ? `<span class="text-[8px] opacity-40 mt-0.5">${hour} ~ ${HOURS[HOURS.indexOf(hour) + mergeCount] || ''}</span>` : ''}
                    <span class="absolute bottom-0.5 right-1 opacity-0 group-hover:opacity-80 transition-opacity"><i data-lucide="settings-2" class="w-3 h-3"></i></span>
                </button>`;
                }
            } else {
                const block = getRoomBlock(hour, room);
                if (block) {
                    const isCustomBlock = block.allowedTeamId === '__custom__';
                    const blockTeam = isCustomBlock ? null : getTeam(block.allowedTeamId);
                    const userCanBook = S.currentUser && (isAdmin() || (
                        isCustomBlock
                            ? (block.allowedUserIds || []).includes(S.currentUser.id)
                            : ((S.currentUser.allowedTeams || []).includes(block.allowedTeamId) && S.selectedTeamId === block.allowedTeamId)
                    ));
                    const bgCls = blockTeam ? `${blockTeam.bg} ${blockTeam.border}` : 'bg-orange-50 border-orange-200';
                    const txtCls = blockTeam ? blockTeam.text : 'text-orange-700';
                    const blockLabel = isCustomBlock ? '기타 전용' : (blockTeam?.name || block.allowedTeamId);
                    td.innerHTML = `<div onclick="${userCanBook ? `handleBookClick('${hour}','${room}')` : ''}" class="w-full min-h-[46px] flex flex-col items-center justify-center rounded-lg border-2 ${bgCls} ${userCanBook ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-60'} transition-all">
                        <span class="text-[9px] font-bold ${txtCls} flex items-center gap-0.5"><i data-lucide="lock" class="w-2.5 h-2.5"></i> 전용</span>
                        <span class="text-[8px] ${txtCls} opacity-70">${esc(blockLabel)}</span>
                        ${userCanBook ? `<span class="text-[8px] ${txtCls} opacity-50 mt-0.5">클릭하여 예약</span>` : ''}
                    </div>`;
                } else {
                    const canBook = S.currentUser && S.selectedTeamId;
                    td.innerHTML = `<div onclick="${canBook ? `handleBookClick('${hour}','${room}')` : ''}" class="w-full min-h-[46px] flex items-center justify-center rounded-lg border border-dashed ${canBook ? 'border-slate-200 hover:border-teal-400 hover:bg-teal-50 cursor-pointer' : 'border-slate-100'} transition-all group">
                        ${canBook ? `<span class="text-[9px] text-slate-300 group-hover:text-teal-500 flex items-center gap-0.5 font-semibold"><i data-lucide="plus" class="w-3 h-3"></i> 예약</span>` : ''}
                    </div>`;
                }
            }
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
    lucide.createIcons();
}

function renderAdminSection() {
    const panel = document.getElementById('admin-section');
    const locked = document.getElementById('admin-locked');
    if (!panel || !locked) return;
    if (isAdmin()) { panel.classList.remove('hidden'); locked.classList.add('hidden'); }
    else { panel.classList.add('hidden'); locked.classList.remove('hidden'); }
}

function renderSideLogs() {
    const c = document.getElementById('side-logs-list');
    if (!c) return;
    
    let logs = S.activityLogs;
    if (S.currentUser) {
        if (S.logFilter === 'my-res') {
            logs = S.activityLogs.filter(log => log.userId === S.currentUser.id && log.action === '예약_생성');
        } else if (S.logFilter === 'my-cancel') {
            logs = S.activityLogs.filter(log => log.action === '예약_강제취소' && log.before?.userId === S.currentUser.id);
        }
    }

    if (logs.length === 0) {
        c.innerHTML = `<div class="text-center py-6 text-slate-400"><i data-lucide="activity" class="w-6 h-6 mx-auto mb-2 opacity-30"></i><p class="text-xs">기록이 없습니다</p></div>`;
        lucide.createIcons(); return;
    }
    const colors = { '예약_생성': 'bg-emerald-50 text-emerald-700', '예약_수정': 'bg-teal-50 text-teal-700', '예약_취소': 'bg-slate-50 text-slate-600', '예약_강제취소': 'bg-red-50 text-red-600', '고정일정_추가': 'bg-blue-50 text-blue-700', '고정일정_삭제': 'bg-orange-50 text-orange-700', '주간리셋': 'bg-purple-50 text-purple-700' };
    c.innerHTML = logs.slice(0, 20).map(log => {
        const col = colors[log.action] || 'bg-slate-50 text-slate-600';
        let time = '-';
        if (log.timestamp) {
            const d = log.timestamp.seconds ? new Date(log.timestamp.seconds * 1000) : new Date(log.timestamp);
            time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        }
        const note = log.after?.note || log.before?.note || '';
        const noteHtml = note ? `<div class="text-[9px] text-teal-600 mt-1 flex items-center gap-1 bg-teal-50/50 border border-teal-100 px-1.5 py-0.5 rounded max-w-full truncate" title="${esc(note)}"><i data-lucide="message-square" class="w-2.5 h-2.5 flex-shrink-0"></i>${esc(note)}</div>` : '';
        return `<div class="p-2 rounded-lg border border-slate-100 bg-white">
            <div class="flex items-center gap-1 flex-wrap">
                <span class="text-[10px] font-bold text-slate-700">${log.displayName || log.username}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded font-bold ${col}">${log.action}</span>
            </div>
            <p class="text-[10px] text-slate-500 mt-0.5 truncate">${log.target}</p>
            ${noteHtml}
            <p class="text-[9px] text-slate-400 mt-0.5">${time}</p>
        </div>`;
    }).join('');
    lucide.createIcons();
}

// ==================== EVENT HANDLERS ====================
function showBookingTypeModal(hour, room) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[99] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-xs border border-slate-200">
                <p class="text-sm font-bold text-slate-800 mb-0.5">예약 방식 선택</p>
                <p class="text-xs text-slate-400 mb-4">${esc(hour)} · ${esc(room)}</p>
                <div class="flex flex-col gap-2">
                    <button id="_bct-single" class="py-3 rounded-xl text-sm font-bold bg-teal-600 text-white hover:bg-teal-700 transition-colors">단일 예약</button>
                    <button id="_bct-range" class="py-3 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center justify-center gap-2">범위 예약 <span class="text-[10px] font-normal text-slate-400">여러 시간대</span></button>
                    <button id="_bct-cancel" class="py-2 rounded-xl text-xs text-slate-400 hover:text-slate-600 transition-colors">취소</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const cleanup = () => document.body.removeChild(overlay);
        overlay.querySelector('#_bct-single').onclick = () => { cleanup(); resolve('single'); };
        overlay.querySelector('#_bct-range').onclick = () => { cleanup(); resolve('range'); };
        overlay.querySelector('#_bct-cancel').onclick = () => { cleanup(); resolve(null); };
        overlay.onclick = e => { if (e.target === overlay) { cleanup(); resolve(null); } };
    });
}

async function handleBookClick(h, r) {
    if (!S.currentUser) { showToast('로그인이 필요합니다.', 'error'); return; }
    if (!S.selectedTeamId) { showToast('활동단을 선택해주세요.', 'error'); return; }
    const block = getRoomBlock(h, r);
    if (block && !isAdmin()) {
        const isCustomBlock = block.allowedTeamId === '__custom__';
        const allowed = isCustomBlock
            ? (block.allowedUserIds || []).includes(S.currentUser.id)
            : ((S.currentUser.allowedTeams || []).includes(block.allowedTeamId) && S.selectedTeamId === block.allowedTeamId);
        if (!allowed) {
            if (isCustomBlock) {
                showToast('이 시간대는 지정된 사용자만 예약할 수 있습니다.', 'error');
            } else {
                const t = getTeam(block.allowedTeamId);
                showToast(`이 시간대는 ${t?.name || '특정 활동단'} 전용입니다.`, 'error');
            }
            return;
        }
    }
    const type = await showBookingTypeModal(h, r);
    if (type === 'single') await makeReservation(h, r);
    else if (type === 'range') await showRangeReserveModal(h, r);
}
window.handleBookClick = handleBookClick;
const handleCancelClick = (h, r) => cancelReservation(h, r);
window.handleCancelClick = handleCancelClick;
window.openReservationDetails = (h, r) => openReservationDetails(h, r);
window.closeReservationDetails = () => closeReservationDetails();

async function approvePendingFromDetail(hour, room, key) {
    if (!isAdmin()) return;
    try {
        await supabase.from('reservations').update({ status: 'approved' })
            .eq('week_id', S.currentWeekId).eq('day_id', S.activeDay).eq('key', key);
        await addActivityLog('예약_승인', `${S.activeDay} ${hour} ${room}`, null, null);
        await addComment(key, `[예약 승인] ${S.currentUser.displayName || S.currentUser.username}이(가) 승인했습니다.`, { isLog: true });
        showToast('예약을 승인했습니다.', 'success');
        closeReservationDetails();
    } catch (e) { showToast('승인 실패: ' + e.message, 'error'); }
}
window.approvePendingFromDetail = approvePendingFromDetail;

async function rejectPendingFromDetail(hour, room, key) {
    if (!isAdmin()) return;
    try {
        const { data: rows } = await supabase.from('reservations').select('*')
            .eq('week_id', S.currentWeekId).eq('day_id', S.activeDay).eq('key', key);
        const resData = rows && rows[0] ? rows[0] : {};
        await addComment(key, `[예약 거절] ${S.currentUser.displayName || S.currentUser.username}이(가) 거절했습니다.`, { isLog: true });
        await supabase.from('reservations').delete()
            .eq('week_id', S.currentWeekId).eq('day_id', S.activeDay).eq('key', key);
        await addActivityLog('예약_거절', `${S.activeDay} ${hour} ${room}`, null, resData);
        showToast('예약 신청을 거절했습니다.', 'info');
        closeReservationDetails();
    } catch (e) { showToast('거절 실패: ' + e.message, 'error'); }
}
window.rejectPendingFromDetail = rejectPendingFromDetail;

function setLogFilter(filter) {
    S.logFilter = filter;
    ['all', 'my-res', 'my-cancel'].forEach(f => {
        const btn = document.getElementById(`btn-log-${f}`);
        if (!btn) return;
        if (f === filter) {
            btn.className = 'flex-1 py-1 rounded font-bold text-center transition-all bg-white text-teal-700 shadow-xs';
        } else {
            btn.className = 'flex-1 py-1 rounded font-bold text-center transition-all text-slate-600 hover:bg-white/50';
        }
    });
    renderSideLogs();
}
window.setLogFilter = setLogFilter;

function switchDay(dayId) {
    S.activeDay = dayId;
    renderDayTabs();
    window.subscribeToReservations && window.subscribeToReservations();
}


export { renderDayTabs, renderTeamSelectors, renderTeamColorLegend, renderTableHeader, getReservationCardStyle, getReservationByContext, canEditReservation, openReservationDetails, closeReservationDetails, renderReservationDetails, renderTable, renderAdminSection, renderSideLogs, showBookingTypeModal, handleBookClick, handleCancelClick, approvePendingFromDetail, rejectPendingFromDetail, setLogFilter, switchDay };
