import { supabase, dbGetMany } from './supabase.js';
import S from './state.js';
import { DEFAULT_TEAMS } from './constants.js';
import { buildMergedReservations } from './ui.js';
import { setupPresence, subscribePresence } from './presence.js';
import { subscribeNotifications } from './notifications.js';

// ── 변환 함수 ─────────────────────────────────────────────────
function rowToReservation(row) {
    return {
        teamId: row.team_id,
        teamName: row.team_name,
        userId: row.user_id,
        userName: row.user_name,
        room: row.room,
        hour: row.hour,
        status: row.status || 'approved',
        isFixed: row.is_fixed || false,
        comments: row.comments || [],
        note: row.note || '',
        approvedBy: row.approved_by || '',
        lessonName: row.lesson_name || '',
        memo: row.memo || '',
        sheetColor: row.sheet_color || '',
        sheetOwner: row.sheet_owner || '',
        updatedBy: row.updated_by || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToFixedSchedule(row) {
    return {
        id: row.id,
        teamId: row.team_id,
        teamName: row.team_name,
        day: row.day,
        room: row.room,
        startHour: row.start_hour,
        endHour: row.end_hour,
        hour: row.hour || '',
        note: (row.data && row.data.note) || '',
        createdBy: (row.data && row.data.createdBy) || '',
    };
}

function rowToTeam(row) {
    const def = DEFAULT_TEAMS.find(t => t.id === row.id);
    return {
        ...(def ? { bg: def.bg, text: def.text, border: def.border, hex: def.hex, hexText: def.hexText } : {}),
        id: row.id,
        name: row.name,
        fullType: row.full_type,
        schedule: row.team_schedule,
        typicalRooms: row.typical_rooms || [],
        bg: row.bg || (def && def.bg) || '',
        text: row.text_class || (def && def.text) || '',
        border: row.border_class || (def && def.border) || '',
        hex: row.hex || (def && def.hex) || '',
        hexText: row.hex_text || (def && def.hexText) || '',
        leaderId: row.leader_id || '',
        leaderIds: row.leader_ids || [],
        slackWebhookUrl: row.slack_webhook_url || '',
    };
}

function rowToRoomBlock(row) {
    const data = row.data || {};
    return {
        id: row.id,
        room: row.room,
        day: row.day,
        startHour: row.start_hour,
        endHour: row.end_hour,
        reason: row.reason || '',
        allowedTeamId: data.allowedTeamId || '',
        allowedTeams: row.allowed_teams || [],
        allowedUserIds: data.allowedUserIds || [],
        allowedUserNames: data.allowedUserNames || [],
        customLabel: data.customLabel || '',
        note: data.note || row.reason || '',
        blockedBy: row.blocked_by || '',
        createdAt: row.created_at,
    };
}

// ==================== DATA ====================
async function initData() {
    loadTeamsFromDB();
    subscribeToFixedSchedules();
    subscribeToReservations();
    subscribeToActivityLogs();
    subscribeRoomBlocks();
    setupPresence();
    subscribePresence();
    subscribeNotifications();
}

function clearAllSubscriptions() {
    if (S.unsubFixed) { S.unsubFixed(); S.unsubFixed = null; }
    if (S.unsubReservations) { S.unsubReservations(); S.unsubReservations = null; }
    if (S.unsubLogs) { S.unsubLogs(); S.unsubLogs = null; }
    if (S.unsubPresence) { S.unsubPresence(); S.unsubPresence = null; }
    if (S.unsubNotifications) { S.unsubNotifications(); S.unsubNotifications = null; }
    if (S.unsubRoomBlocks) { S.unsubRoomBlocks(); S.unsubRoomBlocks = null; }
    if (S.presenceInterval) { clearInterval(S.presenceInterval); S.presenceInterval = null; }
    S.rawReservations = {};
    S.fixedSchedules = [];
    S.activityLogs = [];
    S.roomBlocks = [];
    S.onlineCount = 0;
    S.unreadNotifCount = 0;
}

function updateMergedReservationsAndRender() {
    const df = S.fixedSchedules.filter(fs => fs.day === S.activeDay);
    S.reservations = buildMergedReservations(S.rawReservations, df);
    window.renderTable && window.renderTable();
    if (S.selectedReservationContext && window.renderReservationDetails) window.renderReservationDetails();
}

function subscribeToReservations() {
    if (S.unsubReservations) { S.unsubReservations(); S.unsubReservations = null; }

    let prevRaw = {};

    const handleRows = (rows) => {
        const newRaw = {};
        rows.forEach(row => { newRaw[row.key] = rowToReservation(row); });

        // 강제 취소 감지
        for (const key of Object.keys(prevRaw)) {
            if (!newRaw[key]) {
                const deleted = prevRaw[key];
                if (!deleted.isFixed && S.currentUser && S.currentUser.role === 'user' &&
                    (S.currentUser.allowedTeams || []).length === 1 &&
                    deleted.teamId === S.currentUser.allowedTeams[0] &&
                    deleted.userId === S.currentUser.id && !window.isCancellingLocal) {
                    alert(`⚠️ 안내\n\n관리자에 의해 [${deleted.teamName}]의 예약이 강제 취소되었습니다.\n\n시간: ${S.activeDay.toUpperCase()}요일 ${key.split('-')[0]}`);
                }
            }
        }
        prevRaw = newRaw;
        S.rawReservations = newRaw;
        updateMergedReservationsAndRender();
    };

    // week_id 기준으로 채널 구독 (free tier: 단일 컬럼 필터)
    const channel = supabase.channel(`res-${S.currentWeekId}-${S.activeDay}`)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'reservations',
            filter: `week_id=eq.${S.currentWeekId}`
        }, async () => {
            const { data } = await supabase.from('reservations').select('*')
                .eq('week_id', S.currentWeekId).eq('day_id', S.activeDay);
            handleRows(data || []);
        })
        .subscribe();

    // 초기 로드
    supabase.from('reservations').select('*')
        .eq('week_id', S.currentWeekId).eq('day_id', S.activeDay)
        .then(({ data }) => handleRows(data || []));

    S.unsubReservations = () => supabase.removeChannel(channel);
}

function subscribeToFixedSchedules() {
    if (S.unsubFixed) { S.unsubFixed(); S.unsubFixed = null; }
    const load = async () => {
        try {
            const rows = await dbGetMany('fixed_schedules', {});
            S.fixedSchedules = rows.map(rowToFixedSchedule);
            updateMergedReservationsAndRender();
        } catch (err) { console.error('고정 일정 로드 실패:', err); }
    };
    // 고정일정 변경(관리자 추가/삭제)을 실시간 반영
    const channel = supabase.channel('fixed-schedules-all')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_schedules' }, load)
        .subscribe();
    load();
    S.unsubFixed = () => supabase.removeChannel(channel);
}

function subscribeToActivityLogs() {
    if (S.unsubLogs) return;
    let interval;
    async function fetchLogs() {
        try {
            const rows = await dbGetMany('activity_logs', {}, { orderBy: 'created_at', asc: false, limit: 20 });
            S.activityLogs = rows.map(r => ({
                id: r.id,
                action: r.log_type,
                target: r.action,
                userId: r.user_id,
                username: r.user_name,
                displayName: (r.data && r.data.displayName) || r.user_name,
                userRole: (r.data && r.data.userRole) || '',
                before: (r.data && r.data.before) || null,
                after: (r.data && r.data.after) || null,
                timestamp: r.created_at,
            }));
            window.renderSideLogs && renderSideLogs();
        } catch (err) { console.error('활동 로그 로드 실패:', err); }
    }
    fetchLogs();
    interval = setInterval(fetchLogs, 120000);
    S.unsubLogs = () => clearInterval(interval);
}

function subscribeRoomBlocks() {
    if (S.unsubRoomBlocks) { S.unsubRoomBlocks(); S.unsubRoomBlocks = null; }

    const channel = supabase.channel('room-blocks-all')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'room_blocks' }, async () => {
            const { data } = await supabase.from('room_blocks').select('*');
            S.roomBlocks = (data || []).map(rowToRoomBlock);
            window.renderTable && renderTable();
            if (!document.getElementById('room-block-modal')?.classList.contains('hidden')) {
                window.renderRoomBlockList && renderRoomBlockList();
            }
        })
        .subscribe();

    // 초기 로드
    supabase.from('room_blocks').select('*').then(({ data }) => {
        S.roomBlocks = (data || []).map(rowToRoomBlock);
        window.renderTable && renderTable();
    });

    S.unsubRoomBlocks = () => supabase.removeChannel(channel);
}

function getRoomBlock(hour, room) {
    const h = parseInt(hour);
    return S.roomBlocks.find(b =>
        b.room === room &&
        b.day === S.activeDay &&
        parseInt(b.startHour) <= h &&
        parseInt(b.endHour) > h
    ) || null;
}

async function loadTeamsFromDB() {
    try {
        const rows = await dbGetMany('teams', {});
        if (rows.length > 0) {
            S.TEAMS = rows.map(rowToTeam);
            S.TEAMS.sort((a, b) => {
                const indexA = DEFAULT_TEAMS.findIndex(t => t.id === a.id);
                const indexB = DEFAULT_TEAMS.findIndex(t => t.id === b.id);
                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return a.name.localeCompare(b.name);
            });
        }
    } catch (e) { /* DEFAULT_TEAMS 유지 */ }
    window.renderTeamSelectors && renderTeamSelectors();
    window.renderTeamColorLegend && renderTeamColorLegend();
    window.renderTable && renderTable();
}

export {
    initData, clearAllSubscriptions, updateMergedReservationsAndRender,
    subscribeToReservations, subscribeToFixedSchedules, subscribeToActivityLogs,
    subscribeRoomBlocks, getRoomBlock, loadTeamsFromDB,
    rowToReservation, rowToFixedSchedule, rowToTeam, rowToRoomBlock
};
