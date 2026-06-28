/**
 * youthnaroo 커뮤니티 데이터 레이어 (Firebase, 클라이언트 사이드)
 *
 * 본 모듈은 community/claude.md 가이드라인을 기존 Firebase 스택(Firestore + Auth +
 * Storage, Cloud Functions 없음)으로 구현한 "서버 로직" 계층이다. UI(Open Design
 * 목업: feed/write/post-detail/board/meetup/notifications/profile)에서 import 하여 호출한다.
 *
 * 익명성 원칙:
 *  - 공개 문서(community_posts/{id}, comments/{id})에는 익명 작성자 식별값을 절대 넣지 않는다.
 *  - 실제 authorUid 는 규칙으로 "본인·관리자"만 읽는 private/meta 하위문서에만 둔다.
 *  - 포스트 내 익명 번호(익명 N)는 anonusers/{uid}(본인만 read) 로 안정 매핑, 공개되는 건 정수뿐.
 *  - 관리자 De-anonymize 는 private/meta 직접 읽기(규칙 허용) + activity_logs 기록.
 *
 * 의존: window.ENV (public/env.js, index.html 과 동일 키)
 */

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, startAfter,
  runTransaction, writeBatch, serverTimestamp, increment, arrayUnion, arrayRemove,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 무과금(Spark) 유지: Firebase Storage(Blaze 필요) 대신 압축 WebP를 Firestore 하위컬렉션에 base64로 저장.
// 사용자·활동단 데이터는 본체와 동일하게 Supabase(app_users/teams)에서 읽는다(Auth는 Firebase 공유).

/* ─────────────────────────── 초기화 ─────────────────────────── */

const E = window.ENV || {};
const firebaseConfig = {
  apiKey: E.FIREBASE_API_KEY,
  authDomain: E.FIREBASE_AUTH_DOMAIN,
  databaseURL: E.FIREBASE_DATABASE_URL,
  projectId: E.FIREBASE_PROJECT_ID,
  storageBucket: E.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: E.FIREBASE_MESSAGING_SENDER_ID,
  appId: E.FIREBASE_APP_ID,
  measurementId: E.FIREBASE_MEASUREMENT_ID
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const sb = (E.SUPABASE_URL && E.SUPABASE_ANON_KEY) ? createClient(E.SUPABASE_URL, E.SUPABASE_ANON_KEY) : null;

/* ─────────────────────────── 게시판 정의 (UI 와 일치) ─────────────────────────── */

// ── 게시판 레지스트리 (DB 기반) ─────────────────────────────────────────
// 기능 플래그: anonOnly(익명 전용), allowImages(사진 첨부), allowRating(별점)
const DEFAULT_BOARDS = {
  free:   { name: '자유게시판',     order: 1, anonOnly: false, allowImages: true, allowRating: false },
  secret: { name: '비밀게시판',     order: 2, anonOnly: true,  allowImages: true, allowRating: false },
  info:   { name: '정보게시판',     order: 3, anonOnly: false, allowImages: true, allowRating: false },
  review: { name: '강의·활동 리뷰', order: 4, anonOnly: false, allowImages: true, allowRating: true  },
  meetup: { name: '번개',          order: 5, anonOnly: false, allowImages: true, allowRating: false },
  flex:   { name: '시간표 자랑',    order: 6, anonOnly: false, allowImages: true, allowRating: false },
};
// 런타임 레지스트리(모듈 로드시 기본값 → loadBoards()가 DB로 대체)
const BOARD_REG = {};
function seedRegFromDefaults() {
  for (const k of Object.keys(BOARD_REG)) delete BOARD_REG[k];
  Object.entries(DEFAULT_BOARDS).forEach(([id, b]) => { BOARD_REG[id] = { id, builtin: true, ...b }; });
}
seedRegFromDefaults();

export const BOARDS = BOARD_REG; // 하위호환(읽기용 별칭)
export function getBoard(id) { return BOARD_REG[id] || null; }
export function boardName(id) { return BOARD_REG[id]?.name || id; }
export function isAnonOnly(id) { return !!BOARD_REG[id]?.anonOnly; }
export function boardFeature(id, key) { return !!BOARD_REG[id]?.[key]; }
export function boardExists(id) { return !!BOARD_REG[id]; }

let _boardsLoaded = false;
/** 게시판 목록 로드(+레지스트리 갱신). DB에 문서가 있으면 DB 우선, 없으면 기본값 폴백. */
export async function loadBoards() {
  let docs = [];
  try { docs = (await getDocs(query(collection(db, 'community_boards'), limit(100)))).docs; } catch {}
  if (docs.length) {
    for (const k of Object.keys(BOARD_REG)) delete BOARD_REG[k];
    docs.forEach(d => {
      const x = d.data();
      BOARD_REG[d.id] = {
        id: d.id, builtin: !!x.builtin, name: x.name || d.id, order: x.order ?? 999,
        anonOnly: !!x.anonOnly, allowImages: x.allowImages !== false, allowRating: !!x.allowRating,
        access: x.access === 'restricted' ? 'restricted' : 'all',
        allowedTeams: x.allowedTeams || [], allowedUsers: x.allowedUsers || [],
      };
    });
  } else {
    seedRegFromDefaults();
  }
  _boardsLoaded = true;
  return Object.values(BOARD_REG).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
}
/** boardName 등 동기 호출 보장용: 미로드 시 1회 로드. */
export async function ensureBoardsLoaded() { if (!_boardsLoaded) await loadBoards(); }

/** (관리자) 기본 게시판을 DB에 시드(최초 1회). 이후 기본게시판도 삭제·수정 가능. */
export async function ensureBoardsSeeded() {
  const u = await requireUser();
  if (!u.isAdmin) return false;
  if (!(await getDocs(query(collection(db, 'community_boards'), limit(1)))).empty) return false;
  const flag = await getDoc(doc(db, 'community_meta', 'boards'));
  if (flag.exists() && flag.data().seeded) return false; // 전부 삭제했으면 재시드 안 함
  const batch = writeBatch(db);
  Object.entries(DEFAULT_BOARDS).forEach(([id, b]) => {
    batch.set(doc(db, 'community_boards', id), { ...b, builtin: true, createdBy: u.uid, createdAt: serverTimestamp() });
  });
  batch.set(doc(db, 'community_meta', 'boards'), { seeded: true, at: serverTimestamp() });
  await batch.commit();
  return true;
}

/** (관리자) 게시판 생성(기능 토글 포함). */
export async function createBoard({ name, anonOnly = false, allowImages = true, allowRating = false, access = 'all', allowedTeams = [], allowedUsers = [], id } = {}) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  name = (name || '').trim();
  if (!name) throw new Error('게시판 이름을 입력하세요.');
  const slug = (id || name).toString().trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('b' + Math.abs(hashStr(name)));
  if ((await getDoc(doc(db, 'community_boards', slug))).exists()) throw new Error('이미 같은 이름의 게시판이 있어요.');
  const order = Object.keys(BOARD_REG).length + 1;
  const rec = {
    name, order, anonOnly: !!anonOnly, allowImages: !!allowImages, allowRating: !!allowRating,
    access: access === 'restricted' ? 'restricted' : 'all', allowedTeams: allowedTeams || [], allowedUsers: allowedUsers || [],
    builtin: false, createdBy: u.uid, createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'community_boards', slug), rec);
  BOARD_REG[slug] = { id: slug, builtin: false, ...rec, createdAt: undefined };
  return slug;
}

/** (관리자) 게시판 설정 수정. patch: {name, anonOnly, allowImages, allowRating, access, allowedTeams, allowedUsers} */
export async function updateBoard(id, patch = {}) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const clean = {};
  if (patch.name != null) clean.name = String(patch.name).trim().slice(0, 40);
  ['anonOnly', 'allowImages', 'allowRating'].forEach(k => { if (patch[k] != null) clean[k] = !!patch[k]; });
  if (patch.access != null) clean.access = patch.access === 'restricted' ? 'restricted' : 'all';
  if (patch.allowedTeams != null) clean.allowedTeams = patch.allowedTeams;
  if (patch.allowedUsers != null) clean.allowedUsers = patch.allowedUsers;
  if (!Object.keys(clean).length) return;
  await setDoc(doc(db, 'community_boards', id), clean, { merge: true });
  if (BOARD_REG[id]) Object.assign(BOARD_REG[id], clean);
}

/** 게시판의 활성 글 수(집계). 실패 시 null. */
export async function getBoardPostCount(board) {
  try {
    const s = await getCountFromServer(query(
      collection(db, 'community_posts'),
      where('board', '==', board), where('status', '==', 'ACTIVE')
    ));
    return s.data().count;
  } catch { return null; }
}

/** (관리자) 게시판 삭제(기본·커스텀 모두 가능. 게시글은 남음). */
export async function deleteBoard(id) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  await deleteDoc(doc(db, 'community_boards', id));
  delete BOARD_REG[id];
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0; return h; }

/* ─────────────────────────── 인증 ─────────────────────────── */

let _userPromise = null;
/** 로그인 사용자 프로필 반환({ uid, username, nickname, role, isAdmin }). 미로그인 시 null. */
export function getCurrentUser() {
  if (_userPromise) return _userPromise;
  _userPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) return resolve(null);
      // 1순위: Supabase app_users (본체와 동일 소스). 실패 시 Firestore users 폴백(레거시).
      let row = null;
      if (sb) { try { const r = await sb.from('app_users').select('*').eq('id', user.uid).single(); row = r.data || null; } catch {} }
      let data = {};
      if (!row) { try { data = (await getDoc(doc(db, 'users', user.uid))).data() || {}; } catch {} }
      const role = (row?.role) || data.role || 'user';
      // 커뮤니티는 학과(활동단/부서) 노출 금지 → 표시명 접두어 제거한 '이름'만 사용
      const rawName = row?.name || (row?.display_name) || data.displayName || data.name || '';
      const realName = String(rawName).split('/').pop().trim();
      const communityNick = (row?.data?.communityNickname) || data.communityNickname || '';
      const communityPhotoUrl = (row?.data?.communityPhotoUrl) || data.communityPhotoUrl || '';
      resolve({
        uid: user.uid,
        username: (row?.username) || data.username || '',
        nickname: communityNick || realName || '익명',
        realName,                                   // 시간표 표시 이름(고정)
        hasCustomNick: !!communityNick,
        photoUrl: communityPhotoUrl,                // 커뮤니티 프로필 사진(data URL)
        allowedTeams: (row?.allowed_teams) || data.allowedTeams || [],
        role,
        isAdmin: role === 'admin' || role === 'superadmin',
        isSuperAdmin: role === 'superadmin',
      });
    });
  });
  return _userPromise;
}
async function requireUser() {
  const u = await getCurrentUser();
  if (!u) throw new Error('로그인이 필요합니다.');
  return u;
}

/** 로그아웃. 본체 시간표와 같은 Firebase Auth 세션을 공유하므로 양쪽 모두 로그아웃됨. */
export async function logout() {
  try { await signOut(auth); } catch {}
  _userPromise = null;
}

/**
 * SSO 가드: 커뮤니티는 본체(시간표) 계정·세션을 그대로 공유한다(동일 Firebase 프로젝트,
 * Auth 기본 LOCAL 지속성). 별도 아이디/비밀번호 없음. 미로그인 시 본체 로그인 화면으로 보낸다.
 * 페이지 진입 시 최상단에서 `const me = await requireLoginOrRedirect();` 형태로 호출.
 * @returns 로그인 사용자(리다이렉트되면 Promise 미해결로 흐름 종료)
 */
export async function requireLoginOrRedirect(loginPath = '/') {
  const u = await getCurrentUser();
  if (u) return u;
  const back = encodeURIComponent(location.pathname + location.search);
  location.replace(`${loginPath}?return=${back}`);
  return new Promise(() => {}); // 리다이렉트 진행 — 이후 코드 실행 방지
}

/* ─────────────────────────── 이미지 (Storage) ─────────────────────────── */

// Firestore 1MB/문서 한도를 고려해 이미지 1장을 ~700KB(base64) 이하로 강하게 압축.
const MAX_IMG_BYTES = 720 * 1024;

/** 이미지를 WebP data URL 로 압축. 한도 초과 시 화질·크기를 단계적으로 낮춰 재시도. */
export async function compressToDataUrl(file, { maxDim = 1080 } = {}) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  const tries = [[maxDim, 0.72], [maxDim, 0.6], [900, 0.6], [720, 0.55], [560, 0.5]];
  for (const [dim, q] of tries) {
    const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const url = canvas.toDataURL('image/webp', q);
    if (url.length <= MAX_IMG_BYTES) return url;
  }
  return null; // 끝까지 못 줄이면 건너뜀
}

/**
 * 파일 배열을 압축된 data URL 배열로 변환(최대 10장). 무과금: Storage 미사용.
 * 너무 큰 이미지는 자동으로 건너뛴다.
 */
export async function processImages(files) {
  const list = Array.from(files || []).slice(0, 10);
  const urls = [];
  for (const f of list) {
    const u = await compressToDataUrl(f);
    if (u) urls.push(u);
  }
  return urls;
}

/* ─────────────────────────── 게시글 ─────────────────────────── */

/** 글 작성. 게시판 기능(익명전용/사진/별점)을 반영. 공개문서 + private/meta 원자 생성. */
export async function createPost({ board, title, content, isAnonymous = true, imageFiles = [], rating = 0 }) {
  const u = await requireUser();
  await ensureBoardsLoaded();
  if (!boardExists(board)) throw new Error('알 수 없는 게시판입니다.');
  if (isAnonOnly(board)) isAnonymous = true;
  title = (title || '').trim();
  content = (content || '').trim();
  if (!title || title.length > 60) throw new Error('제목은 1~60자여야 합니다.');
  if (content.length > 1000) throw new Error('본문은 1000자 이하여야 합니다.');

  // 사진 미허용 게시판이면 이미지 무시
  const images = boardFeature(board, 'allowImages') ? await processImages(imageFiles) : [];
  // 별점 허용 게시판이면 1~5 저장
  const rt = boardFeature(board, 'allowRating') ? Math.max(0, Math.min(5, Math.round(Number(rating) || 0))) : 0;
  const postRef = doc(collection(db, 'community_posts'));
  const postId = postRef.id;

  const post = {
    board, title, content,
    isAnonymous: !!isAnonymous,
    authorUid: isAnonymous ? null : u.uid,
    authorNickname: isAnonymous ? null : u.nickname,
    status: 'ACTIVE', reportCount: 0,
    likeCount: 0, scrapCount: 0, commentCount: 0, viewCount: 0, anonSeq: 0,
    imageCount: images.length, // 이미지 본체는 하위컬렉션 — 피드 읽기 비용 절감
    createdAt: serverTimestamp(),
  };
  if (rt) post.rating = rt;
  const batch = writeBatch(db);
  batch.set(postRef, post);
  // 실제 작성자 매핑(익명 글도 항상 기록 — 본인/관리자만 읽기)
  batch.set(doc(db, `community_posts/${postId}/private/meta`), {
    authorUid: u.uid, authorNickname: u.nickname, createdAt: serverTimestamp(),
  });
  // 이미지(base64) — 상세 화면에서만 로드
  images.forEach((data, i) => {
    batch.set(doc(db, `community_posts/${postId}/images/${i}`), { data, order: i });
  });
  // 개인 색인(프로필 '내 글' + 알림 기준 카운트)
  batch.set(doc(db, 'community_index', u.uid, 'posts', postId), { board, isAnonymous: !!isAnonymous, createdAt: serverTimestamp(), seenComments: 0, seenLikes: 0 });
  await batch.commit();
  return postId;
}

/** 게시글 이미지(data URL) 배열 로드 — 상세 화면용. */
export async function getPostImages(postId) {
  try {
    const snap = await getDocs(query(collection(db, `community_posts/${postId}/images`), orderBy('order', 'asc')));
    return snap.docs.map(d => d.data().data).filter(Boolean);
  } catch { return []; }
}

/** 게시판 피드 실시간 구독. cb(posts[]) 호출. unsubscribe 함수 반환. */
export function subscribeFeed(board, cb, { max = 30 } = {}) {
  const q = query(
    collection(db, 'community_posts'),
    where('board', '==', board),
    where('status', '==', 'ACTIVE'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

/** 다음 페이지(무한스크롤). lastDoc 은 직전 페이지 마지막 문서의 createdAt 값. */
export async function fetchFeedPage(board, afterCreatedAt = null, max = 20) {
  let q = query(
    collection(db, 'community_posts'),
    where('board', '==', board),
    where('status', '==', 'ACTIVE'),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
  if (afterCreatedAt) q = query(q, startAfter(afterCreatedAt));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** 게시글 단건 조회 + 조회수 증가. */
export async function getPost(postId, { countView = true } = {}) {
  const ref = doc(db, 'community_posts', postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  if (countView) { try { await updateDoc(ref, { viewCount: increment(1) }); } catch {} }
  return { id: snap.id, ...snap.data() };
}

export async function updatePost(postId, { title, content }) {
  const patch = {};
  if (title != null) patch.title = title.trim().slice(0, 60);
  if (content != null) patch.content = content.trim().slice(0, 1000);
  await updateDoc(doc(db, 'community_posts', postId), patch);
}
export async function deletePost(postId) {
  await deleteDoc(doc(db, 'community_posts', postId));
}

/* ─────────────────────────── 좋아요 / 스크랩 ─────────────────────────── */

/** 좋아요 토글(중복 방지). 반환: 좋아요 활성 여부. */
export async function toggleLike(postId) {
  const u = await requireUser();
  const likeRef = doc(db, `community_posts/${postId}/likes/${u.uid}`);
  const postRef = doc(db, 'community_posts', postId);
  return runTransaction(db, async tx => {
    const liked = (await tx.get(likeRef)).exists();
    const cur = (await tx.get(postRef)).data().likeCount || 0;
    if (liked) { tx.delete(likeRef); tx.update(postRef, { likeCount: Math.max(0, cur - 1) }); return false; }
    tx.set(likeRef, { createdAt: serverTimestamp() }); tx.update(postRef, { likeCount: cur + 1 }); return true;
  });
}
export async function hasLiked(postId) {
  const u = await getCurrentUser(); if (!u) return false;
  return (await getDoc(doc(db, `community_posts/${postId}/likes/${u.uid}`))).exists();
}

/** 스크랩 토글. 반환: 스크랩 활성 여부. */
export async function toggleScrap(postId) {
  const u = await requireUser();
  const scrapRef = doc(db, `community_posts/${postId}/scraps/${u.uid}`);
  const postRef = doc(db, 'community_posts', postId);
  const idxRef = doc(db, 'community_index', u.uid, 'scraps', postId);
  return runTransaction(db, async tx => {
    const has = (await tx.get(scrapRef)).exists();
    const cur = (await tx.get(postRef)).data().scrapCount || 0;
    if (has) { tx.delete(scrapRef); tx.delete(idxRef); tx.update(postRef, { scrapCount: Math.max(0, cur - 1) }); return false; }
    tx.set(scrapRef, { uid: u.uid, postId, createdAt: serverTimestamp() });
    tx.set(idxRef, { createdAt: serverTimestamp() });
    tx.update(postRef, { scrapCount: cur + 1 }); return true;
  });
}

/* ─────────────────────────── 댓글 (포스트 내 익명 번호) ─────────────────────────── */

/** 본인이 이 글의 작성자인지(private/meta 읽기 권한으로 판별). */
async function isPostAuthor(postId, uid) {
  try {
    const s = await getDoc(doc(db, `community_posts/${postId}/private/meta`));
    return s.exists() && s.data().authorUid === uid;
  } catch { return false; }   // 권한 거부 = 작성자 아님
}

/** 포스트 내 안정적 익명 번호 부여(같은 유저는 같은 번호). 트랜잭션. */
async function resolveAnonNum(postId, uid) {
  const anonRef = doc(db, `community_posts/${postId}/anonusers/${uid}`);
  const postRef = doc(db, 'community_posts', postId);
  return runTransaction(db, async tx => {
    const exist = await tx.get(anonRef);
    if (exist.exists()) return exist.data().num;
    const next = ((await tx.get(postRef)).data().anonSeq || 0) + 1;
    tx.update(postRef, { anonSeq: next });
    tx.set(anonRef, { num: next, createdAt: serverTimestamp() });
    return next;
  });
}

/**
 * 댓글 작성. isOp(글쓴이)면 익명 번호 없이 "작성자/글쓴이"로 표시.
 * parentCommentId 가 주어지면 1단계 답글(대댓글)로 기록한다. 답글도 commentCount 에 포함.
 */
export async function addComment(postId, { content, isAnonymous = true, parentCommentId = null }) {
  const u = await requireUser();
  content = (content || '').trim();
  if (!content || content.length > 1000) throw new Error('댓글은 1~1000자여야 합니다.');
  const op = await isPostAuthor(postId, u.uid);
  const anonNum = (isAnonymous && !op) ? await resolveAnonNum(postId, u.uid) : null;

  const cRef = doc(collection(db, `community_posts/${postId}/comments`));
  const batch = writeBatch(db);
  batch.set(cRef, {
    content,
    isAnonymous: !!isAnonymous,
    isOp: op,
    anonNum,
    parentCommentId: parentCommentId || null,
    authorUid: isAnonymous ? null : u.uid,
    authorNickname: isAnonymous ? null : u.nickname,
    likeCount: 0, status: 'ACTIVE',
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, `${cRef.path}/private/meta`), { authorUid: u.uid, createdAt: serverTimestamp() });
  batch.update(doc(db, 'community_posts', postId), { commentCount: increment(1) });
  // 개인 색인(프로필 '댓글 단 글') — 글당 1개
  batch.set(doc(db, 'community_index', u.uid, 'comments', postId), { createdAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return cRef.id;
}

export function subscribeComments(postId, cb, { max = 200 } = {}) {
  const q = query(
    collection(db, `community_posts/${postId}/comments`),
    orderBy('createdAt', 'asc'), limit(max)
  );
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function toggleCommentLike(postId, commentId) {
  // 단순 증가(댓글 좋아요는 중복 방지 생략 — 필요 시 likes 서브컬렉션 추가)
  await updateDoc(doc(db, `community_posts/${postId}/comments/${commentId}`), { likeCount: increment(1) });
}

/** 댓글/게시글 표시용 작성자 라벨. */
export function authorLabel(item) {
  if (item.isOp) return '작성자';
  if (item.isAnonymous) return item.anonNum != null ? `익명 ${item.anonNum}` : '익명';
  return item.authorNickname || '익명';
}

/* ─────────────────────────── 신고 / 모더레이션 ─────────────────────────── */

export const BLIND_THRESHOLD = 5;

/**
 * 신고 접수(§6). 1인 1회 중복 방지(reports/{uid}), 누적이 BLIND_THRESHOLD 이상이면 자동 블라인드.
 * 반환: { duplicate } | { count, blinded }
 */
export async function reportPost(postId, reason = '') {
  const u = await requireUser();
  const repRef = doc(db, `community_posts/${postId}/reports/${u.uid}`);
  const postRef = doc(db, 'community_posts', postId);
  return runTransaction(db, async tx => {
    if ((await tx.get(repRef)).exists()) return { duplicate: true };
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) throw new Error('게시글을 찾을 수 없습니다.');
    const count = (postSnap.data().reportCount || 0) + 1;
    tx.set(repRef, { reason: String(reason).slice(0, 200), createdAt: serverTimestamp() });
    const patch = { reportCount: count };
    const blinded = count >= BLIND_THRESHOLD;
    if (blinded && postSnap.data().status !== 'BLINDED') patch.status = 'BLINDED';
    tx.update(postRef, patch);
    return { count, blinded };
  });
}

/** (관리자) 게시글 블라인드/복구. status 변경은 규칙상 관리자만 가능. */
export async function adminSetPostStatus(postId, status /* 'ACTIVE' | 'BLINDED' */) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  await updateDoc(doc(db, 'community_posts', postId), { status });
  await logAdminAction(u, status === 'BLINDED' ? '커뮤니티_블라인드' : '커뮤니티_블라인드해제', `post:${postId}`);
}

/** (관리자) 게시글 삭제 + 감사 로그. */
export async function adminDeletePost(postId) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  await deleteDoc(doc(db, 'community_posts', postId));
  await logAdminAction(u, '커뮤니티_삭제', `post:${postId}`);
}

/* ─────────────────────────── 관리자 콘솔 조회 ─────────────────────────── */

/** (관리자) 신고 누적 게시글 목록(많은 순). */
export async function getReportedPosts({ max = 50 } = {}) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const snap = await getDocs(query(
    collection(db, 'community_posts'),
    where('reportCount', '>=', 1),
    orderBy('reportCount', 'desc'),
    limit(max)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** (관리자) 최근 게시글 목록. */
export async function getRecentPosts({ max = 50 } = {}) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const snap = await getDocs(query(collection(db, 'community_posts'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** (관리자) 특정 게시글의 신고 사유 목록. */
export async function getPostReports(postId) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const snap = await getDocs(query(collection(db, `community_posts/${postId}/reports`), limit(50)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/** (관리자) 커뮤니티 감사 로그(작성자조회/블라인드/삭제). */
export async function getCommunityAuditLogs({ max = 50 } = {}) {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const snap = await getDocs(query(collection(db, 'activity_logs'), orderBy('timestamp', 'desc'), limit(300)));
  return snap.docs.map(d => d.data()).filter(l => String(l.action || '').startsWith('커뮤니티')).slice(0, max);
}

/* ─────────────────────────── 관리자 De-anonymize ─────────────────────────── */

async function logAdminAction(u, action, target, after = null) {
  try {
    await addDoc(collection(db, 'activity_logs'), {
      userId: u.uid, username: u.username, displayName: u.nickname, userRole: u.role,
      action, target, before: null, after, timestamp: serverTimestamp(),
    });
  } catch {}
}

/** (관리자) 익명 게시글 실제 작성자 조회. private/meta 직접 읽기 + 감사 로그 기록. */
export async function deanonymizePost(postId, reason = '') {
  const u = await requireUser();
  if (!u.isAdmin) throw new Error('관리자 권한이 필요합니다.');
  const meta = (await getDoc(doc(db, `community_posts/${postId}/private/meta`))).data();
  if (!meta) throw new Error('작성자 정보를 찾을 수 없습니다.');
  let profile = {};
  try { profile = (await getDoc(doc(db, 'users', meta.authorUid))).data() || {}; } catch {}
  await logAdminAction(u, '커뮤니티_작성자조회', `post:${postId}`, { authorUid: meta.authorUid, reason: String(reason).slice(0, 200) });
  return { uid: meta.authorUid, nickname: profile.displayName || meta.authorNickname || '', username: profile.username || '' };
}

/* ─────────────────────────── 강의·활동 리뷰 ─────────────────────────── */

export async function addReview(activityId, { rating, content, isAnonymous = true }) {
  const u = await requireUser();
  rating = Math.max(1, Math.min(5, Number(rating) || 0));
  const rRef = doc(collection(db, `community_reviews/${activityId}/items`));
  const batch = writeBatch(db);
  batch.set(rRef, {
    rating, content: (content || '').trim().slice(0, 1000),
    isAnonymous: !!isAnonymous,
    authorUid: isAnonymous ? null : u.uid,
    authorNickname: isAnonymous ? null : u.nickname,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, `${rRef.path}/private/meta`), { authorUid: u.uid, createdAt: serverTimestamp() });
  await batch.commit();
  return rRef.id;
}
export function subscribeReviews(activityId, cb, { max = 100 } = {}) {
  const q = query(collection(db, `community_reviews/${activityId}/items`), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

/* ─────────────────────────── 공강 번개 (Meetup) ─────────────────────────── */

export async function createMeetup({ title, time, location, capacity = 5, isAnonymous = false, endAt = 0, description = '' }) {
  const u = await requireUser();
  const ref = await addDoc(collection(db, 'community_meetups'), {
    title: (title || '').trim().slice(0, 80),
    time: time || '', location: (location || '').slice(0, 80),
    description: (description || '').trim().slice(0, 500),
    endAt: Number(endAt) || 0,            // 종료 시각(ms). 도달 시 클라이언트에서 '지난 번개'로 처리
    capacity: Number(capacity) || 5,
    hostUid: u.uid,
    hostNickname: isAnonymous ? '익명' : u.nickname,
    isAnonymous: !!isAnonymous,
    participants: [u.uid],
    participantCount: 1,
    status: 'OPEN',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
export function subscribeMeetups(cb, { max = 50 } = {}) {
  const q = query(collection(db, 'community_meetups'), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
/** 참여 토글. 반환: 참여 여부. */
export async function toggleMeetupJoin(meetupId) {
  const u = await requireUser();
  const ref = doc(db, 'community_meetups', meetupId);
  return runTransaction(db, async tx => {
    const d = (await tx.get(ref)).data();
    const joined = (d.participants || []).includes(u.uid);
    if (joined) {
      tx.update(ref, { participants: arrayRemove(u.uid), participantCount: Math.max(0, (d.participantCount || 1) - 1) });
      return false;
    }
    if ((d.participantCount || 0) >= (d.capacity || 99)) throw new Error('정원이 찼습니다.');
    tx.update(ref, { participants: arrayUnion(u.uid), participantCount: (d.participantCount || 0) + 1 });
    return true;
  });
}

/** 번개 삭제(주최자·관리자). */
export async function deleteMeetup(meetupId) {
  const u = await requireUser();
  await deleteDoc(doc(db, 'community_meetups', meetupId));
}

/** 사용자 닉네임 조회(캐시). 별명>시간표이름 순. 참여자 표시용. */
const _nickCache = new Map();
export async function getUserNickname(uid) {
  if (!uid) return '익명';
  if (_nickCache.has(uid)) return _nickCache.get(uid);
  let nick = '익명';
  const bare = (s) => String(s || '').split('/').pop().trim(); // 활동단/부서/이름 → 이름(학과 노출 방지)
  if (sb) {
    try { const { data } = await sb.from('app_users').select('display_name,name,data').eq('id', uid).single(); if (data) nick = data.data?.communityNickname || bare(data.name || data.display_name) || '익명'; } catch {}
  }
  if (nick === '익명') { try { const d = (await getDoc(doc(db, 'users', uid))).data() || {}; nick = d.communityNickname || bare(d.displayName) || nick; } catch {} }
  _nickCache.set(uid, nick);
  return nick;
}

/* ─────────────────────────── 1:1 익명채팅 ─────────────────────────── */

/**
 * 랜덤 매칭 시작. 대기 중인 상대가 있으면 즉시 방 생성, 없으면 대기열 등록.
 * 반환: { roomId } (즉시 매칭) | { waiting: true } (상대 대기 중)
 */
export async function startMatch() {
  const u = await requireUser();
  const waiting = await getDocs(query(collection(db, 'chat_queue'), orderBy('createdAt', 'asc'), limit(8)));
  for (const d of waiting.docs) {
    if (d.id === u.uid) continue;
    try {
      const roomId = await runTransaction(db, async tx => {
        const peer = await tx.get(d.ref);
        if (!peer.exists()) throw new Error('taken');
        const roomRef = doc(collection(db, 'chat_rooms'));
        tx.set(roomRef, { participants: [u.uid, d.id], status: 'active', createdAt: serverTimestamp() });
        tx.delete(d.ref);
        tx.delete(doc(db, 'chat_queue', u.uid));
        return roomRef.id;
      });
      return { roomId };
    } catch { /* 이미 매칭됨 → 다음 후보 */ }
  }
  await setDoc(doc(db, 'chat_queue', u.uid), { createdAt: serverTimestamp() });
  return { waiting: true };
}

/** 매칭 대기 중 방 생성 감지. 새 active 방이 생기면 cb(roomId). unsubscribe 반환. */
export function waitForMatch(cb) {
  return getCurrentUser().then(u => {
    if (!u) return () => {};
    const q = query(collection(db, 'chat_rooms'), where('participants', 'array-contains', u.uid));
    return onSnapshot(q, snap => {
      const active = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status === 'active');
      if (active.length) {
        active.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        cb(active[0].id);
      }
    });
  });
}

/** 매칭 취소(대기열에서 제거). */
export async function cancelMatch() {
  const u = await getCurrentUser(); if (!u) return;
  try { await deleteDoc(doc(db, 'chat_queue', u.uid)); } catch {}
}

/** 채팅 메시지 실시간 구독. */
export function subscribeChat(roomId, cb) {
  return onSnapshot(query(collection(db, `chat_rooms/${roomId}/messages`), orderBy('createdAt', 'asc'), limit(500)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
/** 방 상태(상대 나감 등) 구독. */
export function subscribeChatRoom(roomId, cb) {
  return onSnapshot(doc(db, 'chat_rooms', roomId), s => cb(s.exists() ? { id: s.id, ...s.data() } : null));
}
/** 메시지 전송. */
export async function sendChatMessage(roomId, text) {
  const u = await requireUser();
  text = (text || '').trim().slice(0, 500);
  if (!text) return;
  await addDoc(collection(db, `chat_rooms/${roomId}/messages`), { senderUid: u.uid, text, createdAt: serverTimestamp() });
}
/** 채팅 종료(상대에게도 종료 표시). */
export async function leaveChat(roomId) {
  try { await updateDoc(doc(db, 'chat_rooms', roomId), { status: 'ended' }); } catch {}
}

// 메시지 createdAt(Firestore Timestamp 등) → ms
function _tsToMs(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return +new Date(ts) || 0;
}
export const CHAT_EDIT_WINDOW_MS = 30000; // 메시지 수정/삭제 유효시간(30초)

/** 메시지 수정 — 작성자 본인 + 전송 후 30초 이내. */
export async function editChatMessage(roomId, msgId, text) {
  const u = await requireUser();
  text = (text || '').trim().slice(0, 500);
  if (!text) throw new Error('내용을 입력하세요.');
  const ref = doc(db, `chat_rooms/${roomId}/messages`, msgId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('메시지를 찾을 수 없어요.');
  const m = snap.data();
  if (m.senderUid !== u.uid) throw new Error('본인 메시지만 수정할 수 있어요.');
  if (m.deleted) throw new Error('삭제된 메시지예요.');
  const created = _tsToMs(m.createdAt);
  if (created && Date.now() - created > CHAT_EDIT_WINDOW_MS) throw new Error('수정 가능 시간(30초)이 지났어요.');
  await updateDoc(ref, { text, editedAt: serverTimestamp() });
}

/** 메시지 삭제(소프트) — 작성자 본인 + 30초 이내. */
export async function deleteChatMessage(roomId, msgId) {
  const u = await requireUser();
  const ref = doc(db, `chat_rooms/${roomId}/messages`, msgId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const m = snap.data();
  if (m.senderUid !== u.uid) throw new Error('본인 메시지만 삭제할 수 있어요.');
  const created = _tsToMs(m.createdAt);
  if (created && Date.now() - created > CHAT_EDIT_WINDOW_MS) throw new Error('삭제 가능 시간(30초)이 지났어요.');
  await updateDoc(ref, { deleted: true, text: '', deletedAt: serverTimestamp() });
}

/** 채팅 읽음 처리 — 방에 내 마지막 읽은 시각 기록(상대 메시지의 '읽음 시각' 표시용). */
export async function markChatRead(roomId) {
  const u = await requireUser();
  try { await updateDoc(doc(db, 'chat_rooms', roomId), { [`reads.${u.uid}`]: serverTimestamp() }); } catch {}
}

/* ─────────────────────────── 커뮤니티 접속자(presence) ─────────────────────────── */
let _presenceTimer = null;
/** 커뮤니티 접속 하트비트 시작(모든 페이지 상단 접속자 수 표시용). */
export async function startPresence() {
  const u = await getCurrentUser(); if (!u) return;
  const ref = doc(db, 'community_presence', u.uid);
  const beat = () => setDoc(ref, { uid: u.uid, lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  beat();
  if (_presenceTimer) clearInterval(_presenceTimer);
  _presenceTimer = setInterval(beat, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  window.addEventListener('beforeunload', () => { try { deleteDoc(ref); } catch {} });
}
/** 최근 45초 내 활동한 접속자 수 구독. cb(count). */
export function subscribeOnlineCount(cb) {
  const WINDOW = 45000;
  let latest = [];
  const recount = () => cb(latest.filter(ms => Date.now() - ms < WINDOW).length || 0);
  const unsub = onSnapshot(collection(db, 'community_presence'), snap => {
    latest = snap.docs.map(d => _tsToMs(d.data().lastSeen));
    recount();
  });
  // 하트비트가 없어도 만료된 접속자를 주기적으로 반영
  const iv = setInterval(recount, 15000);
  return () => { unsub(); clearInterval(iv); };
}

/* ── 1:1 채팅 로그 열람 (최고관리자 전용) ──────────────────────────────
 * 모든 대화는 chat_rooms/{roomId}/messages 에 영구 보존된다(leaveChat 은 status 만 변경).
 * 아래 함수는 role==='superadmin' 일 때만 동작하는 클라이언트 측 게이트다.
 * 주의: 진정한 서버측 강제는 Firestore 보안 규칙(chat_rooms read 를 superadmin 으로 제한)이
 * 필요하다. 본 아키텍처는 Cloud Functions 미사용이므로 여기서는 클라이언트 게이트 + 규칙 의존이다.
 */
async function requireSuperAdmin() {
  const u = await requireUser();
  if (u.role !== 'superadmin') throw new Error('최고관리자만 접근할 수 있습니다.');
  return u;
}

/** (최고관리자) 전체 채팅방 목록(참여자/시각). 최신순. */
export async function getChatRoomsForAdmin({ max = 100 } = {}) {
  await requireSuperAdmin();
  const snap = await getDocs(query(collection(db, 'chat_rooms'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** (최고관리자) 특정 채팅방의 전체 메시지 로그(시간순). */
export async function getChatMessagesForAdmin(roomId) {
  await requireSuperAdmin();
  const snap = await getDocs(query(collection(db, `chat_rooms/${roomId}/messages`), orderBy('createdAt', 'asc'), limit(2000)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─────────────────────────── 알림 (기존 notifications 패턴 재사용) ─────────────────────────── */

/** 대상 사용자에게 인앱 알림 생성. type: comment|like|meetup|reply|review|notice */
export async function pushNotification(toUid, { type, text, link = '' }) {
  if (!toUid) return;
  await addDoc(collection(db, `notifications/${toUid}/items`), {
    type, text, link, read: false, createdAt: serverTimestamp(),
  });
}
export function subscribeNotifications(cb, { max = 30 } = {}) {
  return getCurrentUser().then(u => {
    if (!u) { cb([]); return () => {}; }
    const q = query(collection(db, `notifications/${u.uid}/items`), orderBy('createdAt', 'desc'), limit(max));
    return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  });
}
export async function markAllNotificationsRead() {
  const u = await requireUser();
  const snap = await getDocs(query(collection(db, `notifications/${u.uid}/items`), where('read', '==', false), limit(300)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

/**
 * 내 글·번개의 변화(댓글/공감/참여)를 감지해 내 알림함에 생성.
 * 익명성 때문에 행위자가 글쓴이 uid를 모르므로, 글쓴이 본인이 앱 진입 시 동기화한다(무과금).
 * 1분 쓰로틀. 최초 동기화는 기준만 잡고 알림은 생성하지 않음(과거 누적 폭주 방지).
 */
export async function syncMyNotifications() {
  const u = await getCurrentUser(); if (!u) return;
  try {
    const last = +(localStorage.getItem('lastNotifSync') || 0);
    if (Date.now() - last < 60000) return;
    localStorage.setItem('lastNotifSync', String(Date.now()));
  } catch {}

  // 내 글: 댓글/공감 증가 감지
  try {
    const idxSnap = await getDocs(query(collection(db, 'community_index', u.uid, 'posts'), orderBy('createdAt', 'desc'), limit(60)));
    for (const d of idxSnap.docs) {
      const idx = d.data();
      let post; try { post = (await getDoc(doc(db, 'community_posts', d.id))).data(); } catch { continue; }
      if (!post) continue;
      const c = post.commentCount || 0, l = post.likeCount || 0;
      const title = (post.title || '내 글').slice(0, 20);
      const patch = {};
      if (!('seenComments' in idx)) patch.seenComments = c;                 // 최초 기준만
      else if (c > idx.seenComments) { await pushNotification(u.uid, { type: 'comment', text: `내 글 "${title}"에 새 댓글이 달렸어요 (총 ${c})`, link: `post-detail.html?id=${d.id}` }); patch.seenComments = c; }
      if (!('seenLikes' in idx)) patch.seenLikes = l;
      else if (l > idx.seenLikes && l > 0) { await pushNotification(u.uid, { type: 'like', text: `내 글 "${title}"에 공감 ${l}개가 모였어요`, link: `post-detail.html?id=${d.id}` }); patch.seenLikes = l; }
      if (Object.keys(patch).length) await setDoc(d.ref, patch, { merge: true });
    }
  } catch {}

  // 내가 주최한 번개: 참여자 증가 감지
  try {
    const ms = await getDocs(query(collection(db, 'community_meetups'), where('hostUid', '==', u.uid), limit(30)));
    for (const m of ms.docs) {
      const md = m.data();
      const seenRef = doc(db, 'community_index', u.uid, 'meetups', m.id);
      const seenDoc = (await getDoc(seenRef)).data();
      const cnt = md.participantCount || 1;
      if (!seenDoc) { await setDoc(seenRef, { seenCount: cnt }); continue; }     // 최초 기준만
      if (cnt > (seenDoc.seenCount || 1)) {
        await pushNotification(u.uid, { type: 'meetup', text: `내 번개 "${(md.title || '').slice(0, 20)}"에 ${cnt - 1}명이 참여 중이에요`, link: 'meetup.html' });
        await setDoc(seenRef, { seenCount: cnt }, { merge: true });
      }
    }
  } catch {}
}

/* ─────────────────────────── 프로필 ─────────────────────────── */

// 개인 색인(community_index/{uid}/{type})에서 postId 목록을 읽어 실제 글을 가져온다.
async function fetchByIndex(uid, type, max) {
  const snap = await getDocs(query(collection(db, 'community_index', uid, type), orderBy('createdAt', 'desc'), limit(max)));
  const ids = snap.docs.map(d => d.id);
  const posts = await Promise.all(ids.map(id => getDoc(doc(db, 'community_posts', id)).catch(() => null)));
  return posts.filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() }));
}

/** 내가 쓴 글(익명 글 포함, 본인에게만 보임). */
export async function getMyPosts({ max = 50 } = {}) {
  const u = await requireUser();
  return fetchByIndex(u.uid, 'posts', max);
}

/** 내가 스크랩한 글. */
export async function getMyScraps({ max = 50 } = {}) {
  const u = await requireUser();
  return fetchByIndex(u.uid, 'scraps', max);
}

/** 내가 댓글 단 글(중복 제거). */
export async function getMyComments({ max = 50 } = {}) {
  const u = await requireUser();
  return fetchByIndex(u.uid, 'comments', max);
}

/** 프로필 통계(작성 글/받은 공감/댓글 수). */
export async function getProfileStats() {
  const posts = await getMyPosts({ max: 500 });
  return {
    postCount: posts.length,
    likeCount: posts.reduce((s, p) => s + (p.likeCount || 0), 0),
    commentCount: posts.reduce((s, p) => s + (p.commentCount || 0), 0),
  };
}

/**
 * 커뮤니티 별명 변경(users/{uid}.communityNickname). 시간표 표시 이름(displayName)은 건드리지 않음.
 * 빈 값으로 호출하면 별명을 해제(시간표 이름으로 표시).
 */
export async function updateMyNickname(nickname) {
  const u = await requireUser();
  nickname = (nickname || '').trim().slice(0, 20);
  if (sb) {
    // app_users.data(jsonb).communityNickname 에 저장(시간표 display_name 은 불변)
    let data = {};
    try { const r = await sb.from('app_users').select('data').eq('id', u.uid).single(); data = r.data?.data || {}; } catch {}
    data.communityNickname = nickname;
    const { error } = await sb.from('app_users').update({ data }).eq('id', u.uid);
    if (error) throw new Error('별명 저장에 실패했어요');
  } else {
    await updateDoc(doc(db, 'users', u.uid), { communityNickname: nickname });
  }
  _nickCache.delete(u.uid);
  u.nickname = nickname || u.realName || '익명';
  u.hasCustomNick = !!nickname;
  return u.nickname;
}

/**
 * 커뮤니티 프로필(별명 + 사진) 통합 저장. app_users.data(jsonb) 에 병합한다.
 * - nickname: 빈 값이면 별명 해제(시간표 이름으로 표시).
 * - photoDataUrl: WebP data URL(또는 ''로 사진 제거). 변경하지 않으려면 undefined 로 전달.
 * 반환: { nickname, hasCustomNick, photoUrl }
 */
export async function updateMyProfile({ nickname, photoDataUrl } = {}) {
  const u = await requireUser();
  const setNick = nickname !== undefined;
  const setPhoto = photoDataUrl !== undefined;
  const nick = setNick ? (nickname || '').trim().slice(0, 20) : undefined;
  if (sb) {
    let data = {};
    try { const r = await sb.from('app_users').select('data').eq('id', u.uid).single(); data = r.data?.data || {}; } catch {}
    if (setNick) data.communityNickname = nick;
    if (setPhoto) data.communityPhotoUrl = photoDataUrl || '';
    const { error } = await sb.from('app_users').update({ data }).eq('id', u.uid);
    if (error) throw new Error('프로필 저장에 실패했어요');
  } else {
    const patch = {};
    if (setNick) patch.communityNickname = nick;
    if (setPhoto) patch.communityPhotoUrl = photoDataUrl || '';
    await updateDoc(doc(db, 'users', u.uid), patch);
  }
  _nickCache.delete(u.uid);
  if (setNick) { u.nickname = nick || u.realName || '익명'; u.hasCustomNick = !!nick; }
  if (setPhoto) u.photoUrl = photoDataUrl || '';
  return { nickname: u.nickname, hasCustomNick: u.hasCustomNick, photoUrl: u.photoUrl };
}

/** 활동단 목록(Supabase teams) → [{id, name}]. 게시판 권한 설정용. */
export async function getTeams() {
  if (!sb) return [];
  try {
    const { data } = await sb.from('teams').select('*').limit(200);
    return (data || []).map(t => ({ id: t.id, name: t.name || t.id }));
  } catch { return []; }
}

/** 게시판 접근 가능 여부(클라이언트 필터). access: all | restricted(allowedTeams/allowedUsers) */
export function canAccessBoard(board, user) {
  if (!board) return false;
  if (board.access !== 'restricted') return true;       // 전체 공개
  if (!user) return false;
  if (user.isAdmin) return true;                          // 관리자 전체 접근
  const teams = user.allowedTeams || [];
  if ((board.allowedTeams || []).some(t => teams.includes(t))) return true;
  if ((board.allowedUsers || []).includes(user.uid)) return true;
  return false;
}

export { db, auth, app };
