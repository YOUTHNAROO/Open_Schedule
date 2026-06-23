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

export { getWeekId, getTeam, isAdmin, esc, isValidHexColor, normalizeColor, getTextColorForBg, getWeekDateRange, getWeeksInMonth };
