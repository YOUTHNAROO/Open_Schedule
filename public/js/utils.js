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

// 모든 에러를 한국어 사용자 메시지로 변환. Firebase Auth 코드 + Supabase/PostgREST + 네트워크.
function koErr(e) {
    const code = (e && e.code) || '';
    const msg = String((e && e.message) || e || '');
    const map = {
        'auth/email-already-in-use': '이미 사용 중인 아이디입니다.',
        'auth/invalid-credential': '아이디 또는 비밀번호가 올바르지 않습니다.',
        'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
        'auth/user-not-found': '등록되지 않은 사용자입니다.',
        'auth/too-many-requests': '시도가 너무 많아 잠시 잠겼습니다. 잠시 후 다시 시도해주세요.',
        'auth/network-request-failed': '네트워크 오류입니다. 인터넷 연결을 확인해주세요.',
        'auth/user-disabled': '비활성화된 계정입니다. 관리자에게 문의하세요.',
        'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
        'auth/invalid-email': '아이디 형식이 올바르지 않습니다.',
        'auth/missing-password': '비밀번호를 입력해주세요.',
        'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도해주세요.',
        'auth/popup-closed-by-user': '인증 창이 닫혔습니다. 다시 시도해주세요.',
    };
    if (map[code]) return map[code];
    if (/duplicate key|already exists|23505/i.test(msg)) return '이미 존재하는 데이터입니다.';
    if (/row-level security|permission denied|not authorized|JWT|401|403/i.test(msg)) return '권한이 없습니다. 다시 로그인한 뒤 시도해주세요.';
    if (/Could not find the .* column|schema cache|PGRST/i.test(msg)) return '데이터 처리 중 오류가 발생했습니다. 관리자에게 문의하세요.';
    if (/Failed to fetch|NetworkError|network|ERR_|timeout/i.test(msg)) return '네트워크 오류입니다. 연결 상태를 확인해주세요.';
    if (/미배포|admin-auth/i.test(msg)) return '서버 기능이 아직 준비되지 않았습니다. 관리자에게 문의하세요.';
    if (/[가-힣]/.test(msg)) return msg;          // 이미 한국어면 그대로
    return '오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}

export { getWeekId, getTeam, isAdmin, esc, isValidHexColor, normalizeColor, getTextColorForBg, getWeekDateRange, getWeeksInMonth, formatWeekLabel, formatPhone, koErr };
