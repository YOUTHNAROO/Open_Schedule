import { supabase, dbInsert, dbUpdate } from './supabase.js';
import S from './state.js';
import { esc } from './utils.js';
import { formatTime } from './ui.js';

// ==================== NOTIFICATIONS (알림) ====================
function subscribeNotifications() {
    if (!S.currentUser) return;
    if (S.unsubNotifications) { S.unsubNotifications(); S.unsubNotifications = null; }

    const channel = supabase.channel(`notif-${S.currentUser.id}`)
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'notifications',
            filter: `to_user_id=eq.${S.currentUser.id}`
        }, async () => {
            const { data } = await supabase.from('notifications')
                .select('*')
                .eq('to_user_id', S.currentUser.id)
                .order('created_at', { ascending: false })
                .limit(30);
            S.unreadNotifCount = (data || []).filter(n => !n.is_read).length;
            renderNotifBadge();
        })
        .subscribe();

    // 초기 뱃지 카운트 로드
    supabase.from('notifications').select('id').eq('to_user_id', S.currentUser.id).eq('is_read', false)
        .then(({ data }) => {
            S.unreadNotifCount = (data || []).length;
            renderNotifBadge();
        });

    S.unsubNotifications = () => supabase.removeChannel(channel);
}

async function sendMentionNotifications(text, context) {
    const mentions = [...new Set((text.match(/@([\w가-힣]+)/g) || []).map(m => m.slice(1)))];
    for (const username of mentions) {
        const u = S.USERS_CACHE.find(u => u.username === username);
        if (!u || u.id === S.currentUser.id) continue;
        await dbInsert('notifications', {
            notif_type: 'mention',
            to_user_id: u.id,
            from_user_id: S.currentUser.id,
            from_user_name: S.currentUser.displayName,
            message: text.slice(0, 100),
            is_read: false,
            data: context,
        }).catch(() => {});
    }
}

async function markAllNotifsRead() {
    if (!S.currentUser) return;
    await supabase.from('notifications')
        .update({ is_read: true })
        .eq('to_user_id', S.currentUser.id)
        .eq('is_read', false)
        .catch(() => {});
}

function renderNotifBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = S.unreadNotifCount > 9 ? '9+' : S.unreadNotifCount;
    badge.classList.toggle('hidden', S.unreadNotifCount === 0);
}

async function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    panel.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs">로딩 중...</div>`;
    panel.classList.remove('hidden');

    const { data: notifs } = await supabase.from('notifications')
        .select('*')
        .eq('to_user_id', S.currentUser.id)
        .order('created_at', { ascending: false })
        .limit(20);

    const pushSupported = 'Notification' in window && window.__osPushOk;
    const pushBanner = pushSupported && Notification.permission === 'default'
        ? `<div class="flex items-center justify-between px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <span class="text-[11px] text-indigo-700 font-medium">📲 푸시 알림을 허용하면 앱 밖에서도 알림을 받아요</span>
            <button onclick="promptPushPermission()" class="text-[10px] font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-2 py-1 rounded-lg shrink-0 ml-2">허용</button>
          </div>` : '';

    if (!notifs || notifs.length === 0) {
        panel.innerHTML = pushBanner + `<div class="p-5 text-center text-slate-400 text-xs">알림이 없습니다.</div>`;
    } else {
        panel.innerHTML = pushBanner + `
            <div class="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span class="text-xs font-bold text-slate-700">알림</span>
                <button onclick="markAllNotifsRead().then(()=>document.getElementById('notif-panel').classList.add('hidden'))" class="text-[10px] text-teal-600 hover:underline">모두 읽음</button>
            </div>
            <div class="max-h-80 overflow-y-auto">
            ${notifs.map(n => `<div class="px-4 py-3 border-b border-slate-50 ${n.is_read ? '' : 'bg-teal-50'} hover:bg-slate-50 transition-colors">
                    <p class="text-xs font-semibold text-slate-800"><span class="text-teal-600">@${esc(n.from_user_name || '')}</span>님이 회원님을 멘션했습니다.</p>
                    <p class="text-[10px] text-slate-500 mt-0.5 line-clamp-2">${esc(n.message || '')}</p>
                    <p class="text-[9px] text-slate-400 mt-1">${formatTime(n.created_at)}</p>
                </div>`).join('')}
            </div>`;
    }
    await markAllNotifsRead();
}

export { subscribeNotifications, sendMentionNotifications, markAllNotifsRead, renderNotifBadge, toggleNotifPanel };
