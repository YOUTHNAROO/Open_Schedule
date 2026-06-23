import { supabase, dbInsert, dbUpsert, dbUpdate, dbDelete, dbGet, dbGetMany } from './supabase.js';
import S from './state.js';
import { HOURS, ALL_ROOMS } from './constants.js';
import { esc, getTeam, isAdmin } from './utils.js';
import { showToast, showModal, hideModal, showConfirm, expandHourRange, setupPersonTagInput, setupTagInput } from './ui.js';
import { addActivityLog } from './logging.js';
import { syncGoogleSheets } from './sheets.js';
import { sendMentionNotifications } from './notifications.js';

// ── helpers ──────────────────────────────────────────────────
function resRowPayload(resData, weekId, dayId, key) {
    const parts = key.split('-');
    const hour = parts[0];
    const room = parts.slice(1).join('-').replace(/_/g, '/');
    return {
        key,
        week_id: weekId,
        day_id: dayId,
        team_id: resData.teamId,
        team_name: resData.teamName,
        user_id: resData.userId,
        user_name: resData.userName,
        room: resData.room || room,
        hour: resData.hour || hour,
        status: resData.status || 'approved',
        is_fixed: resData.isFixed || false,
        note: resData.note || '',
        comments: resData.comments || [],
        approved_by: resData.approvedBy || '',
        lesson_name: resData.lessonName || '',
        memo: resData.memo || '',
        sheet_color: resData.sheetColor || '',
        sheet_owner: resData.sheetOwner || '',
        updated_by: resData.updatedBy || '',
    };
}

function isValidHexColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c); }

// ==================== RESERVATIONS ====================
function openBookingModal({ hour = null, room = null, isRange = false, preHour = null, preRoom = null } = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById('booking-modal');
        if (!modal) { resolve(null); return; }

        const subtitle = document.getElementById('booking-modal-subtitle');
        if (subtitle) subtitle.textContent = isRange ? '범위 예약' : `${hour} · ${room}`;

        const rangeSection = document.getElementById('booking-range-section');
        rangeSection?.classList.toggle('hidden', !isRange);

        if (isRange) {
            const roomSel = document.getElementById('bm-room');
            const startSel = document.getElementById('bm-start');
            const endSel = document.getElementById('bm-end');
            if (roomSel && roomSel.options.length === 0) ALL_ROOMS.forEach(r => roomSel.appendChild(new Option(r, r)));
            if (startSel && startSel.options.length === 0) HOURS.forEach(h => { const hh = parseInt(h); startSel.appendChild(new Option(h, hh)); });
            if (endSel && endSel.options.length === 0) { for (let h = 10; h <= 22; h++) endSel.appendChild(new Option(`${String(h).padStart(2,'0')}:00`, h)); }
            const defaultStartH = preHour ? parseInt(preHour) : 9;
            if (startSel) startSel.value = String(defaultStartH);
            if (endSel) endSel.value = String(Math.min(defaultStartH + 2, 22));
            if (preRoom && roomSel) roomSel.value = preRoom;
        }

        const personInput = document.getElementById('bm-person');
        if (personInput) personInput.value = S.currentUser?.displayName || '';

        const lessonInput = document.getElementById('bm-lesson');
        const reasonInput = document.getElementById('bm-reason');
        const memoInput = document.getElementById('bm-memo');
        const autoTeam = S.selectedTeamId ? getTeam(S.selectedTeamId) : null;
        if (lessonInput) {
            lessonInput.value = autoTeam ? autoTeam.name : '';
            if (!isAdmin()) {
                lessonInput.readOnly = true;
                lessonInput.classList.add('bg-slate-50', 'text-slate-400', 'cursor-not-allowed');
            } else {
                lessonInput.readOnly = false;
                lessonInput.classList.remove('bg-slate-50', 'text-slate-400', 'cursor-not-allowed');
            }
        }
        if (reasonInput) reasonInput.value = '';
        if (memoInput) memoInput.value = '';

        showModal('booking-modal');
        (lessonInput || reasonInput)?.focus();

        setupPersonTagInput(document.getElementById('bm-person'));
        setupTagInput(document.getElementById('bm-memo'));

        const getResult = () => ({
            lessonName: lessonInput?.value.trim().slice(0, 30) || '',
            userName: personInput?.value.trim().slice(0, 20) || (S.currentUser?.displayName || ''),
            note: reasonInput?.value.trim().slice(0, 50) || '',
            memo: memoInput?.value.trim().slice(0, 100) || '',
            ...(isRange ? {
                room: document.getElementById('bm-room')?.value,
                startH: parseInt(document.getElementById('bm-start')?.value || '9'),
                endH: parseInt(document.getElementById('bm-end')?.value || '11'),
            } : { room, hour })
        });

        const submitBtn = document.getElementById('bm-submit');
        const cancelBtn = document.getElementById('bm-cancel');
        const cleanup = () => { hideModal('booking-modal'); submitBtn.removeEventListener('click', onSubmit); cancelBtn.removeEventListener('click', onCancel); modal.removeEventListener('click', onBackdrop); };
        const onSubmit = () => { cleanup(); resolve(getResult()); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onBackdrop = e => { if (e.target?.dataset?.closeModal === 'booking-modal') { cleanup(); resolve(null); } };
        submitBtn.addEventListener('click', onSubmit);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

async function makeReservation(hour, room) {
    if (!S.currentUser) { showToast('로그인이 필요합니다.', 'error'); return; }
    if (!S.selectedTeamId) { showToast('활동단을 선택해주세요.', 'error'); return; }
    const key = `${hour}-${room}`.replace(/\//g, '_');
    if (S.reservations[key]) { showToast('이미 예약된 시간대입니다.', 'error'); return; }
    const team = getTeam(S.selectedTeamId);
    if (!team) return;

    const bookingData = await openBookingModal({ hour, room });
    if (bookingData === null) return;

    const isPendingFlow = !isAdmin();
    const resData = {
        teamId: team.id, teamName: team.name,
        userName: bookingData.userName || S.currentUser.displayName,
        userId: S.currentUser.id, isFixed: false,
        lessonName: bookingData.lessonName,
        note: bookingData.note,
        memo: bookingData.memo,
        status: isPendingFlow ? 'pending' : 'approved',
        room, hour,
    };

    try {
        const existing = await dbGet('reservations', { key, week_id: S.currentWeekId, day_id: S.activeDay });
        if (existing) throw new Error('이미 예약된 시간대입니다.');
        await dbInsert('reservations', resRowPayload(resData, S.currentWeekId, S.activeDay, key));
        await addActivityLog('예약_생성', `${S.activeDay} ${hour} ${room}`, null, resData);
        const logParts = [`[예약 신청] ${team.name}`];
        if (resData.userName) logParts.push(`담당: ${resData.userName}`);
        if (resData.lessonName && resData.lessonName !== team.name) logParts.push(`수업: ${resData.lessonName}`);
        if (isPendingFlow) logParts.push('(승인 대기)');
        await addComment(key, logParts.join(' · '), { isLog: true });
        if (isPendingFlow) {
            showToast(`${team.name} 예약 신청 완료! 담당자 승인 후 확정됩니다.`, 'info');
        } else {
            notifyTeamLead(team.id, '새 예약', `${S.activeDay} ${hour} ${room}`);
            showToast(`${team.name} 예약 완료!`, 'success');
            syncGoogleSheets('reserve', S.activeDay, hour, room, team.name, S.currentUser.displayName, resData.note);
        }
    } catch (e) { showToast(e.message || '예약 실패', 'error'); }
}

function openCancelReservationModal(hour, room, existing, action) {
    return new Promise(resolve => {
        const modal = document.getElementById('cancel-reservation-modal');
        const title = document.getElementById('cancel-modal-title');
        const summary = document.getElementById('cancel-modal-summary');
        const reasonWrap = document.getElementById('cancel-reason-wrap');
        const reasonInput = document.getElementById('cancel-reason-input');
        const submitBtn = document.getElementById('cancel-modal-submit');
        const closeBtn = document.getElementById('cancel-modal-close');
        const needReason = isAdmin() && (action === '예약_강제취소' || action === '고정일정_삭제');

        if (!modal || !submitBtn || !closeBtn) {
            showConfirm(`[${hour}] ${room}\n${existing.teamName} 예약을 취소하시겠습니까?`, { title: '예약 취소', okText: '취소하기', danger: true })
                .then(ok => {
                    if (!ok) { resolve(null); return; }
                    if (needReason) { const reason = prompt('강제 취소 사유(메모)를 입력해 주세요. (생략 가능, 최대 50자)'); resolve(reason === null ? null : reason.trim().slice(0, 50)); }
                    else { resolve(''); }
                });
            return;
        }

        if (title) title.textContent = existing.isFixed ? '고정 일정 삭제' : '예약 취소';
        if (summary) summary.innerHTML = `<div class="font-bold text-slate-900">${esc(existing.teamName)}</div><div class="text-xs text-slate-500 mt-1">${esc(hour)} · ${esc(room)} · ${esc(existing.userName || '예약자 없음')}</div>`;
        if (reasonWrap) reasonWrap.classList.toggle('hidden', !needReason);
        if (reasonInput) { reasonInput.value = ''; reasonInput.placeholder = needReason ? '예: 센터 행사 사용, 중복 예약 정리 등' : '취소 메모'; }
        showModal('cancel-reservation-modal');
        if (needReason && reasonInput) reasonInput.focus();

        const cleanup = result => { hideModal('cancel-reservation-modal'); submitBtn.removeEventListener('click', onSubmit); closeBtn.removeEventListener('click', onClose); modal.removeEventListener('click', onBackdrop); reasonInput?.removeEventListener('keydown', onKeydown); resolve(result); };
        const onSubmit = () => cleanup(needReason ? (reasonInput?.value || '').trim().slice(0, 50) : '');
        const onClose = () => cleanup(null);
        const onBackdrop = e => { if (e.target?.dataset?.closeModal === 'cancel-reservation-modal') cleanup(null); };
        const onKeydown = e => { if (e.key === 'Escape') cleanup(null); if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit(); };
        submitBtn.addEventListener('click', onSubmit);
        closeBtn.addEventListener('click', onClose);
        modal.addEventListener('click', onBackdrop);
        reasonInput?.addEventListener('keydown', onKeydown);
    });
}

async function cancelReservation(hour, room) {
    const key = `${hour}-${room}`.replace(/\//g, '_');
    const existing = S.reservations[key];
    if (!existing || !S.currentUser) return;
    if (existing.isFixed && !isAdmin()) { showToast('고정 일정은 관리자만 취소할 수 있습니다.', 'error'); return; }
    const cancel = isAdmin() || (S.currentUser.allowedTeams || []).includes(existing.teamId);
    if (!cancel) { showToast('본인 활동단 예약만 취소할 수 있습니다.', 'error'); return; }

    const forced = isAdmin() && existing.userId !== S.currentUser.id;
    const action = existing.isFixed ? '고정일정_삭제' : (forced ? '예약_강제취소' : '예약_취소');

    const cancelNote = await openCancelReservationModal(hour, room, existing, action);
    if (cancelNote === null) return;

    window.isCancellingLocal = true;
    try {
        if (existing.isFixed) {
            const rows = await dbGetMany('fixed_schedules', {});
            const toDelete = rows.filter(d => d.day === S.activeDay && d.room === room && expandHourRange(d.start_hour, d.end_hour).includes(hour));
            for (const d of toDelete) await dbDelete('fixed_schedules', { id: d.id });
        } else {
            const cancelLabel = forced ? '[강제 취소]' : '[예약 취소]';
            const cancelLogMsg = `${cancelLabel} ${S.currentUser.displayName || S.currentUser.username}${cancelNote ? ` · 사유: ${cancelNote}` : ''}`;
            await addComment(key, cancelLogMsg, { isLog: true });
            await dbDelete('reservations', { key, week_id: S.currentWeekId, day_id: S.activeDay });
        }
        const targetDesc = `${S.activeDay} ${hour} ${room} [기존: ${existing.teamName} / 예약자: ${existing.userName}]`;
        await addActivityLog(action, targetDesc, existing, cancelNote ? { note: cancelNote } : null);
        notifyTeamLead(existing.teamId, '예약 취소', `${S.activeDay} ${hour} ${room}`);
        showToast('예약이 취소되었습니다.', 'success');
        syncGoogleSheets('cancel', S.activeDay, hour, room, existing.teamName, existing.userName, '');
        window.closeReservationDetails && window.closeReservationDetails();
    } catch (e) {
        showToast('취소 실패: ' + e.message, 'error');
    } finally {
        window.isCancellingLocal = false;
    }
}

async function updateReservationDetails() {
    if (!S.selectedReservationContext || !S.currentUser) return;
    const { hour, room, key } = S.selectedReservationContext;
    const existing = S.reservations[key];
    if (!existing) { window.closeReservationDetails && window.closeReservationDetails(); return; }
    if (existing.isFixed) { showToast('고정 일정은 관리자 고정 일정 메뉴에서 수정해 주세요.', 'error'); return; }
    const canEdit = isAdmin() || (S.currentUser.allowedTeams || []).includes(existing.teamId);
    if (!canEdit) { showToast('수정 권한이 없습니다.', 'error'); return; }

    const teamSelect = document.getElementById('detail-team');
    const customTeam = document.getElementById('detail-team-custom');
    const userName = document.getElementById('detail-user-name');
    const note = document.getElementById('detail-note');
    const adminMode = !!teamSelect;
    const selectedTeam = adminMode ? (teamSelect?.value || 'external') : (existing.teamId || 'external');
    const matchedTeam = selectedTeam === 'external' ? null : getTeam(selectedTeam);
    const nextTeamName = adminMode
        ? (matchedTeam ? matchedTeam.name : (customTeam?.value || existing.teamName || '외부예약').trim().slice(0, 40))
        : existing.teamName;
    const colorHexRaw = adminMode ? (document.getElementById('detail-sheet-color-hex')?.value || '').trim() : (existing.sheetColor || '');
    const newSheetColor = isValidHexColor(colorHexRaw) ? colorHexRaw.toLowerCase() : '';

    const updates = {
        team_id: adminMode ? (matchedTeam ? matchedTeam.id : 'external') : existing.teamId,
        team_name: nextTeamName || '외부예약',
        user_name: adminMode ? ((userName?.value || '').trim().slice(0, 40) || '외부예약') : existing.userName,
        note: (note?.value || '').trim().slice(0, 120),
        sheet_color: newSheetColor,
        sheet_owner: adminMode ? (newSheetColor ? (S.currentUser.displayName || S.currentUser.username || '') : '') : existing.sheetOwner,
        updated_by: S.currentUser.displayName || S.currentUser.username || '',
        updated_at: new Date().toISOString(),
    };

    try {
        await dbUpdate('reservations', { key, week_id: S.currentWeekId, day_id: S.activeDay }, updates);
        await addActivityLog('예약_수정', `${S.activeDay} ${hour} ${room}`, existing, updates);
        syncGoogleSheets('reserve', S.activeDay, hour, room, updates.team_name, updates.user_name, updates.note);
        if (updates.note) await sendMentionNotifications(updates.note, { type: 'memo', key });
        notifyTeamLead(updates.team_id, '예약 수정', `${S.activeDay} ${hour} ${room}`);
        const logParts = [];
        if (existing.teamName !== updates.team_name) logParts.push(`활동단: ${existing.teamName} → ${updates.team_name}`);
        if (existing.userName !== updates.user_name) logParts.push(`담당자: ${existing.userName || '없음'} → ${updates.user_name || '없음'}`);
        if ((existing.note || '') !== (updates.note || '')) { const fromNote = existing.note ? `"${existing.note}"` : '없음'; const toNote = updates.note ? `"${updates.note}"` : '없음'; logParts.push(`메모: ${fromNote} → ${toNote}`); }
        if ((existing.sheetColor || '') !== (updates.sheet_color || '')) logParts.push(`시트색상: ${existing.sheetColor || '없음'} → ${updates.sheet_color || '없음'}`);
        if (logParts.length) await addComment(key, `[수정] ${logParts.join(' / ')}`, { isLog: true });
        showToast('세부 설정이 저장되었습니다.', 'success');
        S.selectedReservationContext = { hour, room, key };
        window.renderReservationDetails && window.renderReservationDetails();
    } catch (e) { showToast('저장 실패: ' + e.message, 'error'); }
}

async function addComment(key, text, { isLog = false } = {}) {
    if (!text.trim() || !S.currentUser) return;
    const trimmed = text.trim().slice(0, 300);
    const row = await dbGet('reservations', { key, week_id: S.currentWeekId, day_id: S.activeDay });
    const comments = row ? (row.comments || []) : [];
    const comment = {
        text: trimmed,
        author: S.currentUser.displayName || S.currentUser.username,
        userId: S.currentUser.id,
        createdAt: new Date().toISOString(),
        ...(isLog ? { isLog: true } : {})
    };
    comments.push(comment);
    if (row) await dbUpdate('reservations', { key, week_id: S.currentWeekId, day_id: S.activeDay }, { comments });
    if (!isLog) await sendMentionNotifications(trimmed, { type: 'comment', key });
}

// ==================== TEAM LEADER NOTIFICATION ====================
async function notifyTeamLead(teamId, actionLabel, detail) {
    const team = getTeam(teamId);
    if (!team) return;
    const msg = `[유스나루 예약] ${actionLabel}\n활동단: ${team.name}\n${detail}\n담당자: ${S.currentUser?.displayName || ''}`;
    const allLeaderIds = team.leaderIds?.length ? team.leaderIds : (team.leaderId ? [team.leaderId] : []);
    const otherLeaderIds = allLeaderIds.filter(id => id !== S.currentUser?.id);
    for (const leaderId of otherLeaderIds) {
        dbInsert('notifications', {
            notif_type: 'reservation',
            to_user_id: leaderId,
            from_user_id: S.currentUser?.id || '',
            from_user_name: S.currentUser?.displayName || '',
            message: msg.slice(0, 200),
            is_read: false,
            data: { type: 'team_lead', teamId },
        }).catch(() => {});
    }
    window.sendOnesignalPush && sendOnesignalPush(otherLeaderIds, `[유스나루] ${actionLabel}`, `${team.name} · ${detail}`);
    if (team.slackWebhookUrl) {
        const params = new URLSearchParams();
        params.set('payload', JSON.stringify({ text: msg }));
        fetch(team.slackWebhookUrl, { method: 'POST', mode: 'no-cors', body: params }).catch(() => {});
    }
}

// ==================== RANGE RESERVATION ====================
async function showRangeReserveModal(preHour = null, preRoom = null) {
    if (!S.currentUser) return;
    const data = await openBookingModal({ isRange: true, preHour, preRoom });
    if (!data) return;
    const { room, startH, endH, lessonName, userName, note, memo } = data;
    if (!S.selectedTeamId || !room) { showToast('활동단과 공간을 선택해주세요.', 'error'); return; }
    if (endH <= startH) { showToast('종료 시간은 시작 시간보다 늦어야 합니다.', 'error'); return; }
    const team = getTeam(S.selectedTeamId);
    if (!team) return;
    const hours = [];
    for (let h = startH; h < endH; h++) hours.push(`${String(h).padStart(2,'0')}:00`);
    const isPendingFlow = !isAdmin();
    const skipped = [];
    for (const hour of hours) {
        const key = `${hour}-${room}`.replace(/\//g, '_');
        if (S.reservations[key]) { skipped.push(hour); continue; }
        const resData = { teamId: team.id, teamName: team.name, userName: userName || S.currentUser.displayName, userId: S.currentUser.id, isFixed: false, lessonName, note, memo, status: isPendingFlow ? 'pending' : 'approved', room, hour };
        await dbInsert('reservations', resRowPayload(resData, S.currentWeekId, S.activeDay, key));
        await addActivityLog('예약_등록', `${S.activeDay} ${hour} ${room}`, null, resData);
        if (!isPendingFlow) syncGoogleSheets('reserve', S.activeDay, hour, room, team.name, userName || S.currentUser.displayName, note);
    }
    if (skipped.length > 0) showToast(`${hours.length - skipped.length}개 등록, ${skipped.length}개 건너뜀 (이미 예약됨)${isPendingFlow ? ' — 담당자 승인 후 확정됩니다.' : ''}`, 'info');
    else showToast(isPendingFlow ? `${hours.length}개 시간대 예약 신청 완료! 담당자 승인 후 확정됩니다.` : `${hours.length}개 시간대 예약 완료.`, 'success');
    if (!isPendingFlow) notifyTeamLead(team.id, '범위 예약', `${S.activeDay} ${hours[0]}~${HOURS[HOURS.indexOf(hours[hours.length-1])+1]||''} ${room}`);
}
window.showRangeReserveModal = showRangeReserveModal;

export { openBookingModal, makeReservation, openCancelReservationModal, cancelReservation, updateReservationDetails, addComment, notifyTeamLead, showRangeReserveModal };
