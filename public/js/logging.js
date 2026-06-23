import { dbInsert } from './supabase.js';
import S from './state.js';

// ==================== LOGGING ====================
async function addLoginLog(userId, username, action, displayName = '') {
    try {
        await dbInsert('login_logs', {
            user_id: userId || null,
            username,
            display_name: displayName,
            action,
            ip: S.clientIP,
            user_agent: navigator.userAgent.slice(0, 200),
        });
    } catch (e) {
        console.error('로그인 로그 기록 실패:', e);
    }
}

async function addActivityLog(action, target, before = null, after = null) {
    if (!S.currentUser) return;
    try {
        await dbInsert('activity_logs', {
            log_type: action,
            action: target,
            user_id: S.currentUser.id,
            user_name: S.currentUser.username,
            week_id: S.currentWeekId,
            day: S.activeDay,
            data: {
                displayName: S.currentUser.displayName,
                userRole: S.currentUser.role,
                before,
                after,
            },
        });
    } catch (e) {
        console.error('활동 로그 기록 실패:', e);
    }
}

export { addLoginLog, addActivityLog };
