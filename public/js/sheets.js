import S from './state.js';

// ==================== GOOGLE SHEETS SYNC ====================
async function syncGoogleSheets(action, day, time, room, teamName, userName, note) {
    try {
        const docRef = doc(db, 'system_settings', 'google_sheets');
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;
        
        const settings = docSnap.data();
        if (!settings.gasWebAppUrl) return;
        
        const dayMap = { mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일', fri: '금요일', sat: '토요일', sun: '일요일' };
        const dayKorean = dayMap[day] || day;
        
        const payload = {
            action: action,
            day: dayKorean,
            time: time,
            room: room,
            teamName: teamName || '',
            userName: userName || '',
            note: note || '',
            activeTabName: settings.activeTabName || ''
        };
        
        fetch(settings.gasWebAppUrl, {
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
