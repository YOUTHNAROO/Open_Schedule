import S from './state.js';
import { DEFAULT_TEAMS } from './constants.js';

// ==================== UTILS ====================
function getWeekId(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const wn = 1 + Math.round(((d - week1) / 864e5 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(wn).padStart(2, '0')}`;
}

function getTeam(teamId) {
    return S.TEAMS.find(t => t.id === teamId);
}

function isAdmin() {
    return S.currentUser && (S.currentUser.role === 'superadmin' || S.currentUser.role === 'admin');
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isValidHexColor(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || '').trim());
}

function normalizeColor(color) {
    const c = String(color || '').trim();
    return isValidHexColor(c) ? c.toLowerCase() : '';
}

function getTextColorForBg(hex) {
    const c = normalizeColor(hex);
    if (!c) return '#334155';
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) > 150 ? '#1e293b' : '#ffffff';
}


function getWeekDateRange(weekId) {
    const [year, wStr] = weekId.split('-W');
    const y = parseInt(year), w = parseInt(wStr);
    const jan4 = new Date(y, 0, 4);
    const startOfW1Mon = new Date(jan4);
    startOfW1Mon.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
    const start = new Date(startOfW1Mon);
    start.setDate(startOfW1Mon.getDate() + (w - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
}

function getWeeksInMonth(year, month) {
    const weeks = [];
    const seen = new Set();
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
        const wid = getWeekId(new Date(d));
        if (!seen.has(wid)) { seen.add(wid); weeks.push(wid); }
        d.setDate(d.getDate() + 1);
    }
    return weeks;
}

// ISO weekId(예: "2026-W26") → "6월 2주차" 형식(해당 주가 속한 달의 N번째 주).
// 기준일은 ISO 주의 목요일(그 주가 속한 달/연도를 결정).
function formatWeekLabel(weekId) {
    if (!weekId || !weekId.includes('-W')) return weekId || '';
    try {
        const { start } = getWeekDateRange(weekId);
        const thu = new Date(start);
        thu.setDate(start.getDate() + 3); // 월요일+3 = 목요일
        const weekOfMonth = Math.ceil(thu.getDate() / 7);
        return `${thu.getMonth() + 1}월 ${weekOfMonth}주차`;
    } catch { return weekId; }
}

// 휴대폰 번호 자동 하이픈: 숫자만 추출 후 010-0000-0000 형식으로 변환.
// 010(11자리) / 01x(10자리) / 02·지역번호 등도 합리적으로 처리. 형식 불명확하면 원본 반환.
function formatPhone(raw) {
    const d = String(raw || '').replace(/[^0-9]/g, '');
    if (!d) return '';
    if (d.startsWith('02')) { // 서울 지역번호
        if (d.length === 9)  return `${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}`;
        if (d.length === 10) return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;
    }
    if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;   // 010-0000-0000
    if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;   // 011-000-0000
    return raw; // 알 수 없는 길이는 그대로
}

export { getWeekId, getTeam, isAdmin, esc, isValidHexColor, normalizeColor, getTextColorForBg, getWeekDateRange, getWeeksInMonth, formatWeekLabel, formatPhone };
