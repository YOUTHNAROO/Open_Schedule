import S from './state.js';
import { db, doc, getDoc } from './firebase.js';

// ==================== GOOGLE SHEETS SYNC ====================
let _gasUrlCache = null;

// GAS URL 로드: env.js → Firestore system_settings/google_sheets 순으로 조회
async function getGasWebAppUrl() {
    if (_gasUrlCache !== null) return _gasUrlCache;
    if (window.ENV?.GAS_WEB_APP_URL) { _gasUrlCache = window.ENV.GAS_WEB_APP_URL; return _gasUrlCache; }
    try {
        const snap = await getDoc(doc(db, 'system_settings', 'google_sheets'));
        _gasUrlCache = snap.exists() ? (snap.data()?.gasWebAppUrl || '') : '';
    } catch { _gasUrlCache = ''; }
    return _gasUrlCache;
}

async function syncGoogleSheets(action, day, time, room, teamName, userName, note) {
    try {
        const gasWebAppUrl = await getGasWebAppUrl();
        if (!gasWebAppUrl) return;

        const dayMap = { mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일', fri: '금요일', sat: '토요일', sun: '일요일' };
        const payload = {
            action,
            day: dayMap[day] || day,
            time,
            room,
            teamName: teamName || '',
            userName: userName || '',
            note: note || '',
        };

        fetch(gasWebAppUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(err => console.error('구글 시트 동기화 전송 에러:', err));

    } catch (err) {
        console.error('구글 시트 연동 실패:', err);
    }
}


export { syncGoogleSheets };
