// Supabase Edge Function: admin-auth
// 목적: 클라이언트에서 불가능한 Firebase Auth 관리 작업을 안전하게 수행.
//   - action: 'deleteUser'  → Firebase Auth 계정 완전 삭제(같은 아이디 재가입 허용; 버그 1)
//   - action: 'setPassword' → 관리자가 다른 사용자의 비밀번호 재설정
//
// 보안: 호출자의 Firebase ID 토큰을 검증하고, app_users에서 role을 확인해
//        admin/superadmin만 허용한다(완전삭제는 superadmin만).
//
// 배포:
//   1) Supabase CLI: `supabase functions deploy admin-auth --no-verify-jwt`
//   2) 시크릿 등록:
//      supabase secrets set FIREBASE_PROJECT_ID=youthnarooschedule
//      supabase secrets set FIREBASE_API_KEY=<env.js의 FIREBASE_API_KEY>
//      supabase secrets set FIREBASE_SERVICE_ACCOUNT='<서비스계정 JSON 전체>'
//      supabase secrets set SUPABASE_URL=<프로젝트 URL>
//      supabase secrets set SERVICE_ROLE_KEY=<service_role 키>
//   ※ 서비스계정 JSON: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성.

const PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID')!;
const API_KEY = Deno.env.get('FIREBASE_API_KEY')!;
const SA = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function b64url(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// 서비스계정으로 Google OAuth2 access token 발급(Identity Toolkit Admin 스코프).
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(SA.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('access_token 발급 실패: ' + JSON.stringify(j));
  return j.access_token;
}

// 호출자 ID 토큰 검증 → uid 반환(Identity Toolkit lookup이 검증까지 수행).
async function verifyCaller(idToken: string): Promise<string> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  const j = await res.json();
  const uid = j?.users?.[0]?.localId;
  if (!uid) throw new Error('유효하지 않은 ID 토큰');
  return uid;
}

async function getRole(uid: string): Promise<string | null> {
  const res = await fetch(`${SB_URL}/rest/v1/app_users?id=eq.${uid}&select=role`, {
    headers: { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}` },
  });
  const rows = await res.json();
  return rows?.[0]?.role ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const { action, idToken, uid, password, email, code, username } = body;
    if (!action) throw new Error('필수 파라미터 누락');

    const base = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`;
    const SB_HEADERS = { apikey: SB_SERVICE_KEY, Authorization: `Bearer ${SB_SERVICE_KEY}`, 'Content-Type': 'application/json' };

    // ── 인증 불필요(공개) 액션: 삭제된 계정 재사용 ──────────────────────────
    // 안전장치: 유효+미사용 초대코드 AND 대상 계정이 비활성/없음 일 때만 허용.
    if (action === 'reclaimDormantAccount') {
      if (!code || !username || !password) throw new Error('code/username/password 누락');
      // 1) 초대코드 검증
      const icRes = await fetch(`${SB_URL}/rest/v1/invite_codes?code=eq.${encodeURIComponent(code)}&select=code,is_used,expires_at,target_username`, { headers: SB_HEADERS });
      const ic = (await icRes.json())?.[0];
      if (!ic) throw new Error('유효하지 않은 초대코드');
      if (ic.is_used) throw new Error('이미 사용된 초대코드');
      if (ic.expires_at && new Date(ic.expires_at) < new Date()) throw new Error('만료된 초대코드');
      if (ic.target_username && ic.target_username !== username) throw new Error('지정 사용자 전용 초대코드');
      // 2) 대상 계정이 활성 상태면 거부(탈취 방지)
      const uRes = await fetch(`${SB_URL}/rest/v1/app_users?username=eq.${encodeURIComponent(username)}&select=id,is_active`, { headers: SB_HEADERS });
      const urow = (await uRes.json())?.[0];
      if (urow && urow.is_active !== false) throw new Error('이미 사용 중인 아이디');
      // 3) Firebase Auth에 남은 계정 조회
      const token0 = await getAccessToken();
      const lemail = `${username}@youthnaroo.local`;
      const look = await fetch(`${base}:lookup`, {
        method: 'POST', headers: { Authorization: `Bearer ${token0}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: [lemail] }),
      });
      const luid = (await look.json())?.users?.[0]?.localId ?? null;
      if (!luid) return new Response(JSON.stringify({ uid: null }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      // 4) 비밀번호 재설정 후 uid 반환
      const upd = await fetch(`${base}:update`, {
        method: 'POST', headers: { Authorization: `Bearer ${token0}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: luid, password }),
      });
      if (!upd.ok) throw new Error('비밀번호 재설정 실패: ' + await upd.text());
      return new Response(JSON.stringify({ uid: luid }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── 이하 관리자 인증 필요 액션 ─────────────────────────────────────────
    if (!idToken) throw new Error('필수 파라미터 누락');
    const callerUid = await verifyCaller(idToken);
    const role = await getRole(callerUid);
    if (role !== 'admin' && role !== 'superadmin') throw new Error('관리자 권한이 필요합니다.');

    const token = await getAccessToken();

    if (action === 'deleteUser') {
      if (role !== 'superadmin') throw new Error('완전 삭제는 최고관리자만 가능합니다.');
      if (!uid) throw new Error('uid 누락');
      const r = await fetch(`${base}:delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: uid }),
      });
      if (!r.ok) throw new Error('Auth 삭제 실패: ' + await r.text());
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (action === 'setPassword') {
      if (!uid || !password) throw new Error('uid/password 누락');
      const r = await fetch(`${base}:update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: uid, password }),
      });
      if (!r.ok) throw new Error('비밀번호 변경 실패: ' + await r.text());
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // 소프트삭제 후 Firebase Auth에 잔존하는 계정 UID 조회 (createUser 시 email-already-in-use 복구용)
    if (action === 'lookupUserByEmail') {
      const lookupEmail = email || (uid ? `${uid}@youthnaroo.local` : null);
      if (!lookupEmail) throw new Error('email 누락');
      const r = await fetch(`${base}:lookup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: [lookupEmail] }),
      });
      const j = await r.json();
      const foundUid = j?.users?.[0]?.localId ?? null;
      return new Response(JSON.stringify({ uid: foundUid }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    throw new Error('알 수 없는 action: ' + action);
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400, headers: CORS });
  }
});
