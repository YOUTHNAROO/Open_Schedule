import { app, auth, initializeApp, getAuth, deleteApp,
    signInWithEmailAndPassword, signOut,
    createUserWithEmailAndPassword, EmailAuthProvider,
    reauthenticateWithCredential, updatePassword } from './firebase.js';
import { supabase, dbGet, dbInsert, dbUpdate } from './supabase.js';
import S from './state.js';
import { esc, isAdmin } from './utils.js';
import { hashAnswer, encryptPassword, decryptPassword } from './crypto.js';
import { showToast, showModal, hideModal, showConfirm } from './ui.js';
import { addLoginLog } from './logging.js';
import { clearPresence } from './presence.js';
import { clearAllSubscriptions } from './data.js';
import { renderTeamSelectors, renderAdminSection, renderTable } from './render.js';
import { renderMobileTeamSelectors, updateMobileBottomBar } from './mobile.js';
import { toggleNotifPanel } from './notifications.js';

// ==================== 회원가입 ====================
const SECURITY_QUESTIONS = [
    '나의 첫 번째 학교 이름은?',
    '어머니의 성함은?',
    '내가 자란 도시(동네) 이름은?',
    '가장 친한 친구의 이름은?',
    '첫 번째 반려동물의 이름은?',
    '내가 졸업한 초등학교 이름은?',
    '좋아하는 선생님의 성함은?',
];

async function handleRegister(e) {
    e.preventDefault();
    const username   = document.getElementById('reg-username')?.value.trim().toLowerCase();
    const dispName   = document.getElementById('reg-dispname')?.value.trim();
    const password   = document.getElementById('reg-password')?.value;
    const password2  = document.getElementById('reg-password2')?.value;
    const inviteCode = document.getElementById('reg-invite')?.value.trim().toUpperCase();
    const phone      = document.getElementById('reg-phone')?.value.trim();
    const secQ       = document.getElementById('reg-sec-q')?.value;
    const secA       = document.getElementById('reg-sec-a')?.value.trim();
    const privacyOk  = document.getElementById('reg-privacy')?.checked;
    const errEl      = document.getElementById('reg-error');
    const showErr    = msg => { if(errEl){ errEl.textContent = msg; errEl.classList.remove('hidden'); } };
    errEl?.classList.add('hidden');

    if (!username || !dispName || !password || !inviteCode || !phone || !secQ || !secA) return showErr('모든 항목을 입력하세요.');
    if (!/^[a-z0-9_]{2,20}$/.test(username)) return showErr('아이디는 영소문자·숫자·_만 2~20자로 입력하세요.');
    if (password.length < 6) return showErr('비밀번호는 6자 이상이어야 합니다.');
    if (password !== password2) return showErr('비밀번호가 일치하지 않습니다.');
    if (secA.length < 2) return showErr('보안 답변을 입력하세요.');
    if (!privacyOk) return showErr('개인정보 수집·이용에 동의해주세요.');

    const btn = document.getElementById('reg-submit-btn');
    btn.disabled = true; btn.textContent = '처리 중...';
    let secApp;
    try {
        // 초대코드 검증 (Supabase)
        const codeRow = await dbGet('invite_codes', { code: inviteCode });
        if (!codeRow) { showErr('유효하지 않은 초대코드입니다.'); return; }
        if (codeRow.is_used) { showErr('이미 사용된 초대코드입니다.'); return; }
        if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) { showErr('만료된 초대코드입니다.'); return; }
        if (codeRow.target_username && codeRow.target_username !== username) { showErr('이 초대코드는 지정된 사용자만 사용할 수 있습니다.'); return; }

        // 중복 아이디 확인
        const existingUser = await supabase.from('app_users').select('id').eq('username', username).single();
        if (existingUser.data) { showErr('이미 사용 중인 아이디입니다.'); return; }

        // Firebase Auth 계정 생성 (보조 앱으로 main onAuthStateChanged 미간섭)
        const email = `${username}@youthnaroo.local`;
        secApp = initializeApp(app.options, 'reg_' + Date.now());
        const secAuth = getAuth(secApp);
        const uc = await createUserWithEmailAndPassword(secAuth, email, password);
        const uid = uc.user.uid;

        // 복구 데이터 암호화
        const answerHash = await hashAnswer(secA);
        const encPw      = await encryptPassword(password, secA);

        // Supabase app_users에 저장
        await dbInsert('app_users', {
            id: uid,
            email,
            username,
            display_name: dispName,
            name: dispName,
            role: codeRow.role || 'user',
            allowed_teams: codeRow.allowed_teams || [],
            is_active: true,
            phone,
            created_by: 'self-register',
            data: {
                privacyConsent: true,
                privacyConsentAt: new Date().toISOString(),
                securityQuestion: secQ,
                securityAnswerHash: answerHash,
                encryptedPassword: encPw,
            },
        });

        // 초대코드 사용 처리
        await dbUpdate('invite_codes', { code: inviteCode }, {
            is_used: true,
            used_by: username,
        });

        await signOut(secAuth);
        showToast('회원가입이 완료되었습니다. 로그인해주세요.', 'success');
        switchLoginTab('login');
        document.getElementById('login-username').value = username;
    } catch(err) {
        showErr(err.code === 'auth/email-already-in-use' ? '이미 사용 중인 아이디입니다.' : (err.message || '오류가 발생했습니다.'));
    } finally {
        try { if (secApp) await deleteApp(secApp); } catch {}
        btn.disabled = false; btn.textContent = '회원가입';
    }
}

// ==================== 비밀번호 찾기 ====================
let _recoveryData = null;

async function handleRecovery1(e) {
    e.preventDefault();
    const username = document.getElementById('rec-username')?.value.trim().toLowerCase();
    const errEl = document.getElementById('rec-error');
    errEl?.classList.add('hidden');
    if (!username) return;
    const btn = document.getElementById('rec-step1-btn');
    btn.disabled = true;
    try {
        // Supabase에서 username으로 조회
        const { data: users } = await supabase.from('app_users').select('*').eq('username', username);
        const userRow = users && users[0];
        if (!userRow || !userRow.data?.securityQuestion) { errEl.textContent = '등록되지 않은 아이디입니다.'; errEl.classList.remove('hidden'); return; }
        _recoveryData = { username, uid: userRow.id, email: userRow.email, ...userRow.data };
        document.getElementById('rec-question-text').textContent = _recoveryData.securityQuestion;
        document.getElementById('rec-step1').classList.add('hidden');
        document.getElementById('rec-step2').classList.remove('hidden');
    } catch(err) { errEl.textContent = '오류: ' + err.message; errEl.classList.remove('hidden'); }
    finally { btn.disabled = false; }
}

async function handleRecovery2(e) {
    e.preventDefault();
    const answer = document.getElementById('rec-answer')?.value.trim();
    const errEl = document.getElementById('rec-error');
    errEl?.classList.add('hidden');
    if (!answer || !_recoveryData) return;
    const btn = document.getElementById('rec-step2-btn');
    btn.disabled = true;
    try {
        const hash = await hashAnswer(answer);
        if (hash !== _recoveryData.securityAnswerHash) { errEl.textContent = '보안 답변이 올바르지 않습니다.'; errEl.classList.remove('hidden'); return; }
        _recoveryData._answer = answer;
        document.getElementById('rec-step2').classList.add('hidden');
        document.getElementById('rec-step3').classList.remove('hidden');
    } catch(err) {
        errEl.textContent = '오류가 발생했습니다: ' + (err.message || err);
        errEl.classList.remove('hidden');
    } finally { btn.disabled = false; }
}

async function handleRecovery3(e) {
    e.preventDefault();
    const newPw  = document.getElementById('rec-newpw')?.value;
    const newPw2 = document.getElementById('rec-newpw2')?.value;
    const errEl  = document.getElementById('rec-error');
    errEl?.classList.add('hidden');
    if (newPw.length < 6) { errEl.textContent = '비밀번호는 6자 이상이어야 합니다.'; errEl.classList.remove('hidden'); return; }
    if (newPw !== newPw2) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; errEl.classList.remove('hidden'); return; }
    const btn = document.getElementById('rec-step3-btn');
    btn.disabled = true;
    let recApp;
    try {
        const oldPw = await decryptPassword(_recoveryData.encryptedPassword, _recoveryData._answer);
        recApp = initializeApp(app.options, 'rec_' + Date.now());
        const recAuth = getAuth(recApp);
        const uc = await signInWithEmailAndPassword(recAuth, _recoveryData.email, oldPw);
        await updatePassword(uc.user, newPw);
        // Supabase 복구 데이터 재암호화
        const encPw = await encryptPassword(newPw, _recoveryData._answer);
        const { data: userRows } = await supabase.from('app_users').select('data').eq('username', _recoveryData.username);
        const userRow = userRows && userRows[0];
        if (userRow) {
            await supabase.from('app_users').update({
                data: { ...userRow.data, encryptedPassword: encPw }
            }).eq('username', _recoveryData.username);
        }
        await signOut(recAuth);
        _recoveryData = null;
        showToast('비밀번호가 변경되었습니다. 다시 로그인하세요.', 'success');
        switchLoginTab('login');
    } catch(err) {
        errEl.textContent = '변경 실패: 보안 답변을 다시 확인하거나 관리자에게 문의하세요.';
        errEl.classList.remove('hidden');
        console.error(err);
    } finally {
        try { if (recApp) await deleteApp(recApp); } catch {}
        btn.disabled = false;
    }
}

// ==================== 비밀번호 변경 (로그인 중) ====================
async function handlePasswordChange(e) {
    e.preventDefault();
    const curPw  = document.getElementById('chpw-current')?.value;
    const newPw  = document.getElementById('chpw-new')?.value;
    const newPw2 = document.getElementById('chpw-new2')?.value;
    const secA   = document.getElementById('chpw-sec-a')?.value.trim();
    const errEl  = document.getElementById('chpw-error');
    errEl?.classList.add('hidden');
    if (!curPw || !newPw || !newPw2) return;
    if (newPw.length < 6) { errEl.textContent = '새 비밀번호는 6자 이상이어야 합니다.'; errEl.classList.remove('hidden'); return; }
    if (newPw !== newPw2) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; errEl.classList.remove('hidden'); return; }
    const btn = document.getElementById('chpw-submit');
    btn.disabled = true;
    try {
        const user = auth.currentUser;
        const email = `${S.currentUser.username}@youthnaroo.local`;
        const cred = EmailAuthProvider.credential(email, curPw);
        await reauthenticateWithCredential(user, cred);
        await updatePassword(user, newPw);
        // Supabase 복구 데이터 재암호화 (보안 답변 제공 시)
        if (secA) {
            const { data: userRows } = await supabase.from('app_users').select('data').eq('id', S.currentUser.id);
            const userRow = userRows && userRows[0];
            if (userRow && userRow.data) {
                const hash = await hashAnswer(secA);
                if (hash === userRow.data.securityAnswerHash) {
                    const encPw = await encryptPassword(newPw, secA);
                    await supabase.from('app_users').update({
                        data: { ...userRow.data, encryptedPassword: encPw }
                    }).eq('id', S.currentUser.id);
                } else { showToast('보안 답변 불일치 — 비밀번호 찾기 기능은 비활성화됩니다.', 'error'); }
            }
        }
        hideModal('change-pw-modal');
        showToast('비밀번호가 변경되었습니다.', 'success');
        document.getElementById('chpw-form')?.reset();
    } catch(err) {
        const map = { 'auth/invalid-credential':'현재 비밀번호가 올바르지 않습니다.', 'auth/wrong-password':'현재 비밀번호가 올바르지 않습니다.' };
        errEl.textContent = map[err.code] || err.message;
        errEl.classList.remove('hidden');
    } finally { btn.disabled = false; }
}

// ==================== AUTH ====================
async function loginUser(username, password) {
    const email = username.includes('@') ? username : `${username}@youthnaroo.local`;

    // Firebase Auth 로그인
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Supabase에서 유저 데이터 조회
    let userRow = await dbGet('app_users', { id: user.uid });

    // 최초 주관리자 계정 폴백
    if (!userRow && email === 'admin@youthnaroo.local') {
        await dbInsert('app_users', {
            id: user.uid,
            email,
            username: 'admin',
            display_name: '시스템관리자',
            name: '시스템관리자',
            role: 'superadmin',
            allowed_teams: [],
            is_active: true,
            created_by: 'system',
            data: {},
        });
        userRow = await dbGet('app_users', { id: user.uid });
    }

    if (!userRow) {
        await signOut(auth);
        throw new Error('등록되지 않은 사용자입니다. 관리자에게 문의하세요.');
    }
    if (!userRow.is_active) {
        await signOut(auth);
        throw new Error('비활성화된 계정입니다. 관리자에게 문의하세요.');
    }

    await addLoginLog(user.uid, userRow.username, 'login', userRow.display_name || userRow.name);

    return {
        id: user.uid,
        username: userRow.username,
        displayName: userRow.display_name || userRow.name,
        role: userRow.role,
        allowedTeams: userRow.allowed_teams || [],
        photoUrl: (userRow.data && userRow.data.photoUrl) || null,
    };
}

async function doLogout() {
    if (S.currentUser) {
        await addLoginLog(S.currentUser.id, S.currentUser.username, 'logout', S.currentUser.displayName);
        await clearPresence();
    }
    await signOut(auth);
    S.currentUser = null; S.selectedTeamId = null;
    clearAllSubscriptions();
    updateHeader(); renderTeamSelectors(); renderAdminSection(); renderTable(); renderMobileTeamSelectors(); updateMobileBottomBar();
    showToast('로그아웃되었습니다.', 'info');
    setTimeout(() => showModal('login-modal'), 400);
}


// ==================== AUTH UI ====================
function authErrMsg(err) {
    const map = {
        'auth/invalid-credential': '아이디 또는 비밀번호가 올바르지 않습니다.',
        'auth/wrong-password': '아이디 또는 비밀번호가 올바르지 않습니다.',
        'auth/user-not-found': '아이디 또는 비밀번호가 올바르지 않습니다.',
        'auth/too-many-requests': '로그인 시도가 너무 많아 일시적으로 잠겼습니다. 잠시 후 다시 시도해주세요.',
        'auth/network-request-failed': '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.',
        'auth/user-disabled': '비활성화된 계정입니다. 관리자에게 문의하세요.',
    };
    return map[err.code] || err.message;
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-submit-btn');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = `<span class="flex items-center gap-2 justify-center"><i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 로그인 중...</span>`;
    lucide.createIcons();
    try {
        const user = await loginUser(username, password);
        showToast(`환영합니다, ${user.displayName}님!`, 'success');
    } catch (err) {
        errEl.textContent = authErrMsg(err); errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="flex items-center gap-2 justify-center"><i data-lucide="log-in" class="w-4 h-4"></i> 로그인</span>`;
        lucide.createIcons();
    }
}

function switchLoginTab(tab) {
    const tabs = { login: 'login-tab-content', register: 'register-tab-content', recovery: 'recovery-tab-content' };
    Object.values(tabs).forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById(tabs[tab])?.classList.remove('hidden');
    document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
}

function updateHeader() {
    const el = document.getElementById('header-user');
    if (!el) return;
    if (S.currentUser) {
        const roleLabel = { superadmin: '👑', admin: '🔧', user: '👤' }[S.currentUser.role] || '';
        const name = S.currentUser.displayName || S.currentUser.username || '사용자';
        const firstChar = name ? name[0] : '👤';
        el.innerHTML = `<div class="flex items-center gap-1.5 sm:gap-2">
            <span id="online-count-badge" class="${S.onlineCount===0?'hidden':''} text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full hidden sm:inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>${S.onlineCount}명 접속 중</span>
            <div class="hidden sm:flex items-center gap-1.5 ${isAdmin() ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-teal-50 border-teal-100 text-teal-700'} px-2.5 py-1.5 rounded-xl border text-xs font-bold">
                ${S.currentUser.photoUrl ? `<img src="${esc(S.currentUser.photoUrl)}" class="w-5 h-5 rounded-full object-cover shrink-0">` : ''}
                <span>${roleLabel} ${esc(name)}</span>
                ${isAdmin() ? `<a href="admin.html" class="text-xs text-amber-600 hover:text-amber-800 font-semibold border-l border-amber-200 pl-2 transition-colors">관리</a>` : ''}
            </div>
            <!-- Mobile Avatar -->
            ${S.currentUser.photoUrl
                ? `<img src="${esc(S.currentUser.photoUrl)}" class="sm:hidden w-8 h-8 rounded-full object-cover border border-white shadow-sm" title="${esc(name)}">`
                : `<div class="sm:hidden bg-gradient-to-br ${isAdmin() ? 'from-amber-400 to-amber-600' : 'from-teal-400 to-teal-600'} text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold border border-white shadow-sm" title="${esc(name)}">${esc(firstChar)}</div>`
            }
            ${isAdmin() ? `<a href="admin.html" class="sm:hidden text-slate-400 hover:text-amber-600 transition-colors p-1.5 rounded-lg hover:bg-amber-50" title="관리자 페이지"><i data-lucide="settings" class="w-4 h-4"></i></a>` : ''}
            <div class="relative">
                <button id="notif-btn" class="text-slate-400 hover:text-teal-600 transition-colors p-1.5 rounded-lg hover:bg-teal-50" title="알림"><i data-lucide="bell" class="w-4 h-4"></i></button>
                <span id="notif-badge" class="${S.unreadNotifCount===0?'hidden':''} absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5">${S.unreadNotifCount>9?'9+':S.unreadNotifCount}</span>
            </div>
            <button id="chpw-btn" class="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100" title="비밀번호 변경"><i data-lucide="key-round" class="w-4 h-4"></i></button>
            <button id="logout-btn" class="text-slate-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50" title="로그아웃"><i data-lucide="log-out" class="w-4 h-4"></i></button>
        </div>`;
        document.getElementById('chpw-btn')?.addEventListener('click', () => { document.getElementById('chpw-form')?.reset(); document.getElementById('chpw-error')?.classList.add('hidden'); showModal('change-pw-modal'); });
        document.getElementById('logout-btn').addEventListener('click', () => {
            showConfirm('정말 로그아웃 하시겠습니까?', { title: '로그아웃', okText: '로그아웃', danger: false }).then(ok => { if (ok) doLogout(); });
        });
        document.getElementById('notif-btn')?.addEventListener('click', e => { e.stopPropagation(); toggleNotifPanel(); });
    } else {
        el.innerHTML = `<button id="login-btn-h" class="flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-3 py-1.5 rounded-lg transition-all"><i data-lucide="log-in" class="w-3.5 h-3.5"></i> 로그인</button>`;
        document.getElementById('login-btn-h').addEventListener('click', () => showModal('login-modal'));
    }
    lucide.createIcons();
}

export { handleRegister, handleRecovery1, handleRecovery2, handleRecovery3, handlePasswordChange, switchLoginTab, loginUser, doLogout, authErrMsg, handleLoginSubmit, updateHeader, SECURITY_QUESTIONS };
