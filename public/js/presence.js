import { supabase, dbUpsert, dbDelete } from './supabase.js';
import S from './state.js';
import { esc } from './utils.js';

// ==================== PRESENCE (접속자 수) ====================
async function setupPresence() {
    if (!S.currentUser) return;
    const write = () => dbUpsert('active_sessions', {
        id: S.currentUser.id,
        user_id: S.currentUser.id,
        user_name: S.currentUser.username,
        display_name: S.currentUser.displayName,
        role: S.currentUser.role,
        photo_url: S.currentUser.photoUrl || null,
        ip: S.clientIP || '',
        last_seen: new Date().toISOString(),
        week_id: S.currentWeekId,
    }, 'id').catch(() => {});
    await write();
    S.presenceInterval = setInterval(write, 55000);
    window.addEventListener('beforeunload', () => {
        dbDelete('active_sessions', { id: S.currentUser.id }).catch(() => {});
    });
}

async function clearPresence() {
    if (!S.currentUser) return;
    if (S.presenceInterval) { clearInterval(S.presenceInterval); S.presenceInterval = null; }
    try { await dbDelete('active_sessions', { id: S.currentUser.id }); } catch {}
}

function subscribePresence() {
    if (S.unsubPresence) { S.unsubPresence(); S.unsubPresence = null; }
    let interval;
    async function fetchPresence() {
        try {
            const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
            const { data } = await supabase.from('active_sessions')
                .select('*').gt('last_seen', threshold);
            S.onlineCount = (data || []).length;
            S.onlineUsers = (data || []).map(r => ({
                id: r.id,
                username: r.user_name,
                displayName: r.display_name,
                role: r.role,
                photoUrl: r.photo_url,
                lastSeen: new Date(r.last_seen).getTime(),
            }));
            S.onlineUsers.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
            renderOnlineCount();
        } catch {}
    }
    fetchPresence();
    interval = setInterval(fetchPresence, 60000);
    S.unsubPresence = () => clearInterval(interval);
}

function renderOnlineCount() {
    const el = document.getElementById('online-count-badge');
    if (!el) return;
    el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>${S.onlineCount}명 접속 중`;
    el.classList.toggle('hidden', S.onlineCount === 0);
    if (!el._onlineClickBound) {
        el._onlineClickBound = true;
        el.style.cursor = 'pointer';
        el.addEventListener('click', e => {
            e.stopPropagation();
            toggleOnlineUsersPopup(el);
        });
    }
}

function toggleOnlineUsersPopup(anchor) {
    let popup = document.getElementById('online-users-popup');
    if (popup) { popup.remove(); return; }

    popup = document.createElement('div');
    popup.id = 'online-users-popup';
    popup.className = 'fixed z-[9999] bg-white rounded-2xl shadow-2xl border border-slate-200 py-3 min-w-[220px] max-w-[300px]';

    const roleLabel = r => ({ superadmin: '관리자', admin: '관리자', user: '일반' }[r] || '');
    const roleColor = r => ({ superadmin: 'text-amber-600', admin: 'text-amber-600', user: 'text-slate-400' }[r] || 'text-slate-400');

    popup.innerHTML = `
        <div class="px-4 pb-2 border-b border-slate-100 mb-2">
            <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                <span class="text-xs font-bold text-slate-700">현재 접속 중 (${S.onlineCount}명)</span>
            </div>
        </div>
        <div class="px-2 space-y-0.5 max-h-72 overflow-y-auto">
            ${S.onlineUsers.map(u => {
                const name = esc(u.displayName || u.username || '사용자');
                const initial = name ? name[0] : '?';
                const isMe = S.currentUser && u.id === S.currentUser.id;
                return `<div class="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors">
                    ${u.photoUrl
                        ? `<img src="${esc(u.photoUrl)}" class="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200">`
                        : `<span class="w-8 h-8 rounded-full ${u.role === 'admin' || u.role === 'superadmin' ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'} text-sm font-bold flex items-center justify-center shrink-0">${initial}</span>`
                    }
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold text-slate-800 leading-tight truncate">${name}${isMe ? ' <span class="text-[10px] text-slate-400 font-normal">(나)</span>' : ''}</p>
                        <p class="text-[11px] ${roleColor(u.role)} leading-tight">@${esc(u.username || '')} · ${roleLabel(u.role)}</p>
                    </div>
                    <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                </div>`;
            }).join('')}
        </div>`;

    document.body.appendChild(popup);

    const rect = anchor.getBoundingClientRect();
    const popW = 260;
    let left = rect.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    popup.style.top = (rect.bottom + 6) + 'px';
    popup.style.left = left + 'px';
    popup.style.width = popW + 'px';

    const close = e => { if (!popup.contains(e.target) && e.target !== anchor) { popup.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
}

export { setupPresence, clearPresence, subscribePresence, renderOnlineCount, toggleOnlineUsersPopup };
