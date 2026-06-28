import S from './state.js';
import { auth } from './firebase.js';
import { showToast } from './ui.js';

// ==================== ONESIGNAL PUSH ====================
// Init happens in the non-module <script> in <head>. Here we only login after auth.
function initOneSignal() {
    if (!S.currentUser || !window.__osPushOk) return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function(OneSignal) {
        try { await OneSignal.login(S.currentUser.id); } catch {}
    });
}

// 자체 한국어 안내 모달을 먼저 띄우고, '받기' 클릭 시에만 브라우저 네이티브 권한창 호출.
// OneSignal 자체 프롬프트/슬라이드다운(영어·스캠 느낌)은 일절 사용하지 않는다.
function promptPushPermission() {
    if (!window.__osPushOk) {
        showToast('푸시 알림을 현재 사용할 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.', 'error');
        return;
    }
    const modal = document.getElementById('push-permission-modal');
    if (!modal) { requestNativePushPermission(); return; } // 모달 없으면 바로 네이티브
    modal.classList.remove('hidden');
}

// 브라우저 표준 권한창만 호출 + 허용 시 OneSignal 구독 동기화
async function requestNativePushPermission() {
    try {
        let perm = (typeof Notification !== 'undefined') ? Notification.permission : 'denied';
        if (perm === 'default' && typeof Notification !== 'undefined') {
            perm = await Notification.requestPermission(); // OS 표준 다이얼로그
        }
        if (perm === 'granted') {
            window.OneSignalDeferred = window.OneSignalDeferred || [];
            window.OneSignalDeferred.push(async function (OneSignal) {
                try { await OneSignal.User.PushSubscription.optIn(); } catch {}
                try { if (S.currentUser) await OneSignal.login(S.currentUser.id); } catch {}
            });
            showToast('알림이 켜졌습니다.', 'success');
        } else if (perm === 'denied') {
            showToast('브라우저에서 알림이 차단되어 있어요. 주소창의 자물쇠 → 알림 허용으로 켤 수 있어요.', 'error');
        }
    } catch { showToast('알림 설정 중 오류가 발생했습니다.', 'error'); }
}

// 모달 버튼 1회 배선
function _wirePushPermModal() {
    const modal = document.getElementById('push-permission-modal');
    if (!modal || modal.dataset.wired) return;
    modal.dataset.wired = '1';
    const hide = () => modal.classList.add('hidden');
    document.getElementById('push-perm-later')?.addEventListener('click', hide);
    document.getElementById('push-perm-allow')?.addEventListener('click', () => { hide(); requestNativePushPermission(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wirePushPermModal);
    else _wirePushPermModal();
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
