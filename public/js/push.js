import S from './state.js';
import { auth } from './firebase.js';

// ==================== ONESIGNAL PUSH ====================
// Init happens in the non-module <script> in <head>. Here we only login after auth.
function initOneSignal() {
    if (!S.currentUser || !window.__osPushOk) return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function(OneSignal) {
        try { await OneSignal.login(S.currentUser.id); } catch {}
    });
}

function promptPushPermission() {
    if (!window.__osPushOk) {
        showToast('푸시 알림을 현재 사용할 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.', 'error');
        return;
    }
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function(OneSignal) {
        // OneSignal 브랜드 슬라이드다운 대신 브라우저 네이티브 권한창을 직접 호출 —
        // 피싱 느낌 없이 OS 표준 다이얼로그만 노출된다.
        try { await OneSignal.Notifications.requestPermission(); } catch {}
    });
}
window.promptPushPermission = promptPushPermission;

// 보안: OneSignal REST 키는 클라이언트에 두지 않는다. 서버(Edge Function)에서만 발송.
// 로그인 사용자의 Firebase idToken으로 인증한다.
async function sendOnesignalPush(externalUserIds, title, body) {
    if (!externalUserIds?.length) return;
    try {
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();
        await fetch(`${window.ENV.SUPABASE_URL}/functions/v1/admin-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.ENV.SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'sendPush', idToken, externalUserIds, title, body }),
        });
    } catch {}
}


export { initOneSignal, promptPushPermission, sendOnesignalPush };
