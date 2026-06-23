import { DEFAULT_TEAMS } from './constants.js';

function _getWeekId() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const wn = 1 + Math.round(((d - week1) / 864e5 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

const S = {
    TEAMS: [...DEFAULT_TEAMS],
    currentUser: null,
    activeDay: 'sat',
    selectedTeamId: null,
    reservations: {},
    fixedSchedules: [],
    rawReservations: {},
    unsubFixed: null,
    unsubReservations: null,
    unsubLogs: null,
    currentWeekId: _getWeekId(),
    clientIP: '알 수 없음',
    activityLogs: [],
    logFilter: 'all',
    selectedReservationContext: null,
    USERS_CACHE: [],
    unsubPresence: null,
    presenceInterval: null,
    onlineCount: 0,
    onlineUsers: [],
    unsubNotifications: null,
    unreadNotifCount: 0,
    roomBlocks: [],
    unsubRoomBlocks: null,
};

export default S;
