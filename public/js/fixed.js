import { supabase, dbInsert, dbGetMany, dbDelete } from './supabase.js';
import S from './state.js';
import { getWeekId, getTeam, isAdmin } from './utils.js';
import { showToast, showConfirm, expandHourRange } from './ui.js';
import { addActivityLog } from './logging.js';
import { syncGoogleSheets } from './sheets.js';
import { updateMergedReservationsAndRender } from './data.js';

// ==================== FIXED SCHEDULES ====================
async function addFixedScheduleRange({ teamId, day, room, startHour, endHour, note }) {
    const hrs = expandHourRange(startHour, endHour);
    if (hrs.length === 0) { showToast('시간 범위가 올바르지 않습니다. 종료 시간은 시작 시간보다 늦어야 합니다.', 'error'); return; }
    const team = getTeam(teamId);
    if (!team) return;
    const fsData = { teamId, teamName: team.name, day, room, startHour, endHour, note: note || '', createdBy: S.currentUser.displayName };

    try {
        await dbInsert('fixed_schedules', {
            id: `${teamId}-${day}-${room}-${startHour}-${endHour}-${Date.now()}`,
            day,
            team_id: teamId,
            team_name: team.name,
            room,
            start_hour: startHour,
            end_hour: endHour,
            data: { note: note || '', createdBy: S.currentUser.displayName },
        });
        await addActivityLog('고정일정_추가', `${day} ${startHour}~${endHour} ${room}`, null, fsData);
        S.fixedSchedules.push({ id: fsData.teamId + '-' + day + '-' + room + '-' + startHour + '-' + endHour, teamId, teamName: team.name, day, room, startHour, endHour, note: note || '', createdBy: S.currentUser.displayName });
        updateMergedReservationsAndRender();
        showToast('고정 일정이 추가되었습니다.', 'success');
        hrs.forEach(h => {
            syncGoogleSheets('reserve', day, h, room, team.name, '고정 일정', note || '');
        });
    } catch (e) { showToast('추가 실패: ' + e.message, 'error'); }
}

// ==================== WEEKLY RESET ====================
async function weeklyReset() {
    if (!isAdmin()) return;
    if (!await showConfirm(`주차: ${S.currentWeekId}\n일반 예약이 모두 삭제됩니다. (고정 일정 유지)\n과거 기록에 보관됩니다.`, { title: '⚠️ 주간 리셋 실행', okText: '리셋', danger: true })) return;

    try {
        // 현재 주차의 모든 예약을 archive에 저장
        const { data: allRes } = await supabase.from('reservations')
            .select('*').eq('week_id', S.currentWeekId);

        const archiveData = {};
        for (const row of (allRes || [])) {
            if (!archiveData[row.day_id]) archiveData[row.day_id] = {};
            archiveData[row.day_id][row.key] = row;
        }

        await supabase.from('archive').upsert({
            week_id: S.currentWeekId,
            data: archiveData,
            archived_at: new Date().toISOString(),
            archived_by: S.currentUser.displayName,
        }, { onConflict: 'week_id' });

        // 일반 예약만 삭제 (고정 일정 유지)
        await supabase.from('reservations')
            .delete()
            .eq('week_id', S.currentWeekId)
            .eq('is_fixed', false);

        await addActivityLog('주간리셋', S.currentWeekId, null, null);
        showToast('주간 리셋 완료. 과거 기록이 보관되었습니다.', 'success');
    } catch (e) { showToast('리셋 실패: ' + e.message, 'error'); }
}

export { addFixedScheduleRange, weeklyReset };
