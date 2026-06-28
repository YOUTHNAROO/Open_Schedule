import S from './state.js';

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

async function sendOnesignalPush(externalUserIds, title, body) {
    if (!externalUserIds?.length || ONESIGNAL_REST_API_KEY === 'YOUR_ONESIGNAL_REST_KEY') return;
    try {
        await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                include_aliases: { external_id: externalUserIds },
                target_channel: 'push',
                headings: { ko: title, en: title },
                contents: { ko: body, en: body }
            })
        });
    } catch {}
}


export { initOneSignal, promptPushPermission, sendOnesignalPush };
