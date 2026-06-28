import { app, auth, db, doc, getDoc, initializeApp, getAuth, deleteApp,
    signInWithEmailAndPassword, signOut,
    createUserWithEmailAndPassword, EmailAuthProvider,
    reauthenticateWithCredential, updatePassword } from './firebase.js';
import { supabase, dbGet, dbInsert, dbUpdate, dbDelete } from './supabase.js';
import S from './state.js';
import { esc, isAdmin, formatPhone, koErr } from './utils.js';
import { hashAnswer, encryptPassword, decryptPassword } from './crypto.js';
import { showToast, showModal, hideModal, showConfirm } from './ui.js';
import { addLoginLog } from './logging.js';
import { clearPresence } from './presence.js';
import { clearAllSubscriptions } from './data.js';
import { renderTeamSelectors, renderAdminSection, renderTable } from './render.js';
import { renderMobileTeamSelectors, updateMobileBottomBar } from './mobile.js';
import { toggleNotifPanel } from './notifications.js';

// ==================== 회원가입 ====================

/**
 * 표시명(display name) 계산. 관리자 측 데이터 계약과 정확히 일치시킴.
 * - staff: department ? `${department}/${name}` : `${name}`
 * - youth 관리자(운영): `[운영]${teamName}/${name}` (부서 없음)
 * - youth 일반:
 *     teamName && department  → `${teamName}/${department}/${name}`
 *     teamName && !department → `${teamName}/${name}`
 *     !teamName               → `${name}`
 */
function computeDisplayName({ userType, teamName, department, name, role } = {}) {
    const nm = (name || '').trim();
    const dept = (department || '').trim();
    const team = (teamName || '').trim();
    if (userType === 'staff') {
        return dept ? `${dept}/${nm}` : `${nm}`;
    }
    // 청소년 관리자 = 운영진: [운영] 접두어, 부서 없이 활동단만
    if (role === 'admin' || role === 'superadmin') return team ? `[운영]${team}/${nm}` : `[운영]${nm}`;
    // youth (default)
    if (team && dept) return `${team}/${dept}/${nm}`;
    if (team)         return `${team}/${nm}`;
    return `${nm}`;
}

// 현재 검증된 초대코드의 컨텍스트(폼 채우기/표시명 계산용).
let _regInviteCtx = null; // { userType, teamName, deptMode: 'select'|'input'|'none', deptList: [], fixedDept }

// 회원가입 폼의 부서 현재값(모드별)
function _getRegDepartment() {
    const ctx = _regInviteCtx;
    if (!ctx) return '';
    if (ctx.deptMode === 'select') return document.getElementById('reg-dept-select')?.value || '';
    if (ctx.deptMode === 'input')  return document.getElementById('reg-dept-input')?.value.trim() || '';
    return '';
}

// 표시명 미리보기 라이브 갱신
function refreshRegDisplayName() {
    const ctx = _regInviteCtx;
    const userType = ctx?.userType || 'youth';
    const teamName = ctx?.teamName || null;
    const department = _getRegDepartment();
    const name = document.getElementById('reg-name')?.value || '';
    const computed = computeDisplayName({ userType, teamName, department, name, role: ctx?.role });
    const out = document.getElementById('reg-dispname');
    if (out) out.value = computed;

    const hint = document.getElementById('reg-dispname-hint');
    if (hint) {
        if (userType === 'staff') hint.textContent = '표시명은 [부서]/[이름] 형식으로 자동 생성됩니다.';
        else hint.textContent = '표시명은 [활동단]/[부서]/[이름] 형식으로 자동 생성됩니다.';
    }
    // 제출 버튼 활성화: 이름이 있어야 표시명 계산 가능
    const btn = document.getElementById('reg-submit-btn');
    if (btn) btn.disabled = !name.trim();
    return computed;
}

// 초대코드 입력 시 meta + team dept_config 읽어 폼 구성
async function applyRegInvite() {
    const inviteCode = document.getElementById('reg-invite')?.value.trim().toUpperCase();
    const statusEl = document.getElementById('reg-invite-status');
    const setStatus = (msg, ok) => {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('hidden', !msg);
        statusEl.classList.toggle('text-emerald-600', !!ok);
        statusEl.classList.toggle('text-red-500', !ok);
    };
    const usertypeWrap = document.getElementById('reg-usertype-wrap');
    const teamWrap = document.getElementById('reg-team-wrap');
    const deptWrap = document.getElementById('reg-dept-wrap');
    const deptSelect = document.getElementById('reg-dept-select');
    const deptInput = document.getElementById('reg-dept-input');

    // 초기화
    _regInviteCtx = null;
    usertypeWrap?.classList.add('hidden');
    teamWrap?.classList.add('hidden');
    deptWrap?.classList.add('hidden');
    deptSelect?.classList.add('hidden');
    deptInput?.classList.add('hidden');

    if (!inviteCode) { setStatus('', false); refreshRegDisplayName(); return; }

    let codeRow;
    try {
        codeRow = await dbGet('invite_codes', { code: inviteCode });
    } catch { setStatus('초대코드 확인 중 오류가 발생했습니다.', false); return; }
    if (!codeRow) { setStatus('유효하지 않은 초대코드입니다.', false); refreshRegDisplayName(); return; }
    if (codeRow.is_used) { setStatus('이미 사용된 초대코드입니다.', false); refreshRegDisplayName(); return; }
    if (codeRow.expires_at && new Date(codeRow.expires_at) < new Date()) { setStatus('만료된 초대코드입니다.', false); refreshRegDisplayName(); return; }

    const meta = codeRow.meta || {};
    const userType = meta.userType === 'staff' ? 'staff' : 'youth';
    const allowed = codeRow.allowed_teams || [];

    const ctx = { userType, teamName: null, deptMode: 'none', deptList: [], fixedDept: '', role: codeRow.role || 'user' };

    // 구분 뱃지
    const utInput = document.getElementById('reg-usertype');
    if (utInput) utInput.value = userType;
    const badge = document.getElementById('reg-usertype-badge');
    if (badge) {
        if (userType === 'staff') {
            badge.textContent = '직원';
            badge.className = 'inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200';
        } else {
            badge.textContent = '청소년';
            badge.className = 'inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200';
        }
    }
    usertypeWrap?.classList.remove('hidden');

    if (userType === 'staff') {
        // 직원: 팀 없음, 부서 자유 입력
        ctx.deptMode = 'input';
        if (deptInput) {
            deptInput.value = meta.department || '';
            deptInput.classList.remove('hidden');
        }
        deptWrap?.classList.remove('hidden');
    } else {
        // 청소년: allowed_teams[0]의 팀명 + dept_config
        const teamId = allowed[0];
        if (teamId) {
            let team = null;
            try { team = await dbGet('teams', { id: teamId }); } catch {}
            if (team) {
                ctx.teamName = team.name || null;
                const teamNameEl = document.getElementById('reg-teamname');
                if (teamNameEl) teamNameEl.value = team.name || '';
                teamWrap?.classList.remove('hidden');

                const dc = team.dept_config || {};
                const list = Array.isArray(dc.list) ? dc.list : [];
                if (dc.enabled && list.length && meta.deptEnabled !== false) {
                    ctx.deptMode = 'select';
                    ctx.deptList = list;
                    if (deptSelect) {
                        deptSelect.innerHTML = '';
                        deptSelect.appendChild(new Option('(부서 없음)', ''));
                        list.forEach(d => deptSelect.appendChild(new Option(d, d)));
                        // 초대코드 meta가 부서를 고정한 경우 적용
                        if (meta.department && list.includes(meta.department)) deptSelect.value = meta.department;
                        deptSelect.classList.remove('hidden');
                    }
                    deptWrap?.classList.remove('hidden');
                }
            }
        }
    }

    _regInviteCtx = ctx;
    setStatus('확인되었습니다.', true);
    refreshRegDisplayName();
}

// 폼 라이브 이벤트 위임 (auth.js 모듈 로드 시 1회). app.js를 건드리지 않기 위함.
function _setupRegFormListeners() {
    const form = document.getElementById('register-form');
    if (!form || form.dataset.deptWired) return;
    form.dataset.deptWired = '1';
    let inviteTimer = null;
    form.addEventListener('input', (e) => {
        const id = e.target?.id;
        if (id === 'reg-invite') {
            clearTimeout(inviteTimer);
            inviteTimer = setTimeout(() => { applyRegInvite(); }, 350);
        } else if (id === 'reg-name' || id === 'reg-dept-input') {
            refreshRegDisplayName();
        }
    });
    form.addEventListener('change', (e) => {
        if (e.target?.id === 'reg-dept-select') refreshRegDisplayName();
    });
    // 연락처 자동 하이픈(010-0000-0000): 입력칸을 떠날 때 정규화
    form.addEventListener('blur', (e) => {
        if (e.target?.id === 'reg-phone') e.target.value = formatPhone(e.target.value);
    }, true);
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _setupRegFormListeners);
    } else {
        _setupRegFormListeners();
    }
}

const SECURITY_QUESTIONS = [
    '나의 첫 번째 학교 이름은?',
    '어머니의 성함은?',
    '내가 자란 도시(동네) 이름은?',
    '가장 친한 친구의 이름은?',
    '첫 번째 반려동물의 이름은?',
    '내가 졸업한 초등학교 이름은?',
    '좋아하는 선생님의 성함은?',
];

// 삭제됐지만 Firebase Auth에 남아있는 계정을, 유효한 미사용 초대코드로 재사용(서버에서 비번 재설정).
// 관리자 권한 없이 호출 가능하지만, 서버가 (초대코드 유효+미사용) AND (대상 계정이 비활성/없음)일 때만 허용.
async function reclaimDormantAccount({ code, username, password }) {
    const res = await fetch(`${window.ENV.SUPABASE_URL}/functions/v1/admin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.ENV.SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'reclaimDormantAccount', code, username, password }),
    });
    if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error('계정 재사용 실패: ' + (msg || 'admin-auth 미배포 또는 권한 오류'));
    }
    return res.json().catch(() => ({}));
}

async function handleRegister(e) {
    e.preventDefault();
    const username   = document.getElementById('reg-username')?.value.trim().toLowerCase();
    const realName   = document.getElementById('reg-name')?.value.trim();
    const password   = document.getElementById('reg-password')?.value;
    const password2  = document.getElementById('reg-password2')?.value;
    const inviteCode = document.getElementById('reg-invite')?.value.trim().toUpperCase();
    const phone      = formatPhone(document.getElementById('reg-phone')?.value.trim());
    const secQ       = document.getElementById('reg-sec-q')?.value;
    const secA       = document.getElementById('reg-sec-a')?.value.trim();
    const privacyOk  = document.getElementById('reg-privacy')?.checked;
    const errEl      = document.getElementById('reg-error');
    const showErr    = msg => { if(errEl){ errEl.textContent = msg; errEl.classList.remove('hidden'); } };
    errEl?.classList.add('hidden');

    if (!username || !realName || !password || !inviteCode || !phone || !secQ || !secA) return showErr('모든 항목을 입력하세요.');
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

        // 부서/구분/표시명 계산 (제출 시점에 codeRow로 재계산하여 견고하게)
        const meta = codeRow.meta || {};
        const userType = meta.userType === 'staff' ? 'staff' : 'youth';
        const allowedTeams = codeRow.allowed_teams || [];
        let teamName = null;
        if (userType === 'youth' && allowedTeams[0]) {
            try { const t = await dbGet('teams', { id: allowedTeams[0] }); teamName = t?.name || null; } catch {}
        }
        const department = _getRegDepartment();
        const dispName = computeDisplayName({ userType, teamName, department, name: realName, role: codeRow.role });
        if (!dispName) { showErr('표시명을 생성할 수 없습니다. 이름을 확인해주세요.'); return; }

        // 중복 아이디 확인. 활성 계정이면 차단, 비활성(삭제됨)이면 '재가입'으로 처리.
        const { data: existingUsers } = await supabase.from('app_users').select('id, is_active').eq('username', username);
        const existingUser = existingUsers?.[0];
        if (existingUser && existingUser.is_active !== false) { showErr('이미 사용 중인 아이디입니다.'); return; }
        const isReclaim = !!existingUser; // 비활성 계정 재가입

        // Firebase Auth 계정 생성 (보조 앱으로 main onAuthStateChanged 미간섭)
        const email = `${username}@youthnaroo.local`;
        secApp = initializeApp(app.options, 'reg_' + Date.now());
        const secAuth = getAuth(secApp);
        let uid;
        try {
            const uc = await createUserWithEmailAndPassword(secAuth, email, password);
            uid = uc.user.uid;
        } catch (e) {
            // 삭제됐지만 Firebase Auth 계정이 남아있는 경우 → 유효한 초대코드로 '재사용'(서버 함수가 비번 재설정)
            if (e.code === 'auth/email-already-in-use') {
                const reclaimed = await reclaimDormantAccount({ code: inviteCode, username, password });
                if (!reclaimed?.uid) { showErr('이미 사용 중인 아이디입니다. (재사용 실패 — 관리자에게 문의)'); return; }
                uid = reclaimed.uid;
            } else throw e;
        }

        // 재가입: 남아있던 비활성 행 제거 후 새 행 삽입(같은 uid 재사용 가능)
        if (isReclaim) { try { await dbDelete('app_users', { username }); } catch {} }

        // 복구 데이터 암호화
        const answerHash = await hashAnswer(secA);
        const encPw      = await encryptPassword(password, secA);

        // Supabase app_users에 저장
        await dbInsert('app_users', {
            id: uid,
            email,
            username,
            display_name: dispName,
            name: realName,
            role: codeRow.role || 'user',
            allowed_teams: allowedTeams,
            is_active: true,
            phone,
            created_by: 'self-register',
            data: {
                privacyConsent: true,
                privacyConsentAt: new Date().toISOString(),
                securityQuestion: secQ,
                securityAnswerHash: answerHash,
                encryptedPassword: encPw,
                userType,
                department: department || '',
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
        showErr(koErr(err));
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
    } catch(err) { errEl.textContent = koErr(err); errEl.classList.remove('hidden'); }
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
        errEl.textContent = koErr(err);
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
        errEl.textContent = map[err.code] || koErr(err);
        errEl.classList.remove('hidden');
    } finally { btn.disabled = false; }
}

// ==================== AUTH ====================
// 레거시(Firebase Firestore 시절) 사용자를 로그인 시점에 Supabase로 자동 이관(self-heal).
// 버그 2(관리자페이지에서 만든 유저가 예약페이지에서 로그인 안 됨)·3(레거시 Firebase 유저 로그인 안 됨)의 근본 처리.
// 관리자 페이지가 아직 Firestore에 유저를 쓰던 시절의 계정을, 첫 로그인 때 app_users로 복사한다.
async function migrateLegacyUserToSupabase(uid, fallbackUsername, email) {
    let legacy = null;
    try { legacy = (await getDoc(doc(db, 'users', uid))).data() || null; } catch {}
    if (!legacy) return null; // 레거시 문서조차 없으면 이관 불가(진짜 미등록 계정)

    const uname = legacy.username || fallbackUsername;

    // 복구 정보(보안질문/암호화 비번)는 self-register 시절 user_recovery/{username}에 있을 수 있음(없어도 로그인엔 무관)
    let rec = {};
    try { rec = (await getDoc(doc(db, 'user_recovery', uname))).data() || {}; } catch {}

    const row = {
        id: uid,
        email,
        username: uname,
        display_name: legacy.displayName || uname,
        name: legacy.displayName || uname,
        role: legacy.role || 'user',
        allowed_teams: legacy.allowedTeams || [],
        is_active: legacy.isActive !== false,
        phone: legacy.phone || null,
        created_by: legacy.createdBy || 'legacy-migration',
        data: {
            ...(legacy.photoUrl ? { photoUrl: legacy.photoUrl } : {}),
            ...(rec.securityQuestion ? { securityQuestion: rec.securityQuestion } : {}),
            ...(rec.securityAnswerHash ? { securityAnswerHash: rec.securityAnswerHash } : {}),
            ...(rec.encryptedPassword ? { encryptedPassword: rec.encryptedPassword } : {}),
            migratedFromFirestore: true,
        },
    };
    try {
        await dbInsert('app_users', row);
    } catch (e) {
        // 동시 로그인 등으로 이미 생성됐을 수 있음 — 무시하고 재조회
        console.warn('[migrate] app_users insert 보류(이미 존재 가능):', e?.message);
    }
    return await dbGet('app_users', { id: uid });
}

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

    // 레거시 Firestore 사용자 자동 이관 (버그 2·3)
    if (!userRow) {
        userRow = await migrateLegacyUserToSupabase(user.uid, email.split('@')[0], email);
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
    const forms = { login: 'lform-login', register: 'lform-register', recover: 'lform-recover' };
    Object.values(forms).forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById(forms[tab])?.classList.remove('hidden');
    ['login', 'register', 'recover'].forEach(t => {
        const btn = document.getElementById('ltab-' + t);
        if (!btn) return;
        if (t === tab) {
            btn.classList.add('text-teal-600', 'border-b-2', 'border-teal-500', 'bg-teal-50');
            btn.classList.remove('text-slate-400');
        } else {
            btn.classList.remove('text-teal-600', 'border-b-2', 'border-teal-500', 'bg-teal-50');
            btn.classList.add('text-slate-400');
        }
    });
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
            ${isAdmin() ? `<a href="admin.html" class="sm:hidden inline-flex items-center justify-center text-slate-400 hover:text-amber-600 transition-colors p-1.5 rounded-lg hover:bg-amber-50" title="관리자 페이지"><i data-lucide="settings" class="w-4 h-4"></i></a>` : ''}
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

export { handleRegister, handleRecovery1, handleRecovery2, handleRecovery3, handlePasswordChange, switchLoginTab, loginUser, doLogout, authErrMsg, handleLoginSubmit, updateHeader, SECURITY_QUESTIONS, computeDisplayName, migrateLegacyUserToSupabase };
