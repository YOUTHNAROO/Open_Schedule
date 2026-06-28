/**
 * 커뮤니티 공용 UI 헬퍼 — 렌더 함수 + 토스트 + 시간표시.
 * community-data.js(데이터 레이어) 위에서 동작. 디자인 클래스는 assets/everytime.css 사용.
 */
import { BOARDS, boardName, authorLabel } from './community-data.js?v=9';

export const ANON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7 2 4 6 4 11c0 3 2 5 4 6 0 2 2 5 4 5s4-3 4-5c2-1 4-3 4-6 0-5-3-9-8-9Zm-3 9a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Zm6 0a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
const CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z"/></svg>';
const IMG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m3 17 5-4 4 3 3-2 6 5"/></svg>';

/** HTML 이스케이프 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 본문 내 URL/도메인을 클릭 가능한 링크로 변환.
 * 반드시 esc()로 이미 HTML 이스케이프된 텍스트에 적용할 것(XSS·이중 이스케이프 방지).
 * - http(s):// 스킴이 있는 URL
 * - 스킴이 없어도 알려진 TLD(.com .kr .io 등, .co.kr/.or.kr/.go.kr 포함)로 끝나는 베어 도메인
 *   → https:// 를 자동으로 붙여 링크화.
 */
const _TLDS = ['com', 'net', 'org', 'kr', 'io', 'co', 'xyz', 'me', 'gg', 'dev', 'app', 'ai', 'edu', 'gov'];
// 멀티세그먼트 TLD를 먼저(우선순위) — co.kr / or.kr / go.kr
const _TLD_ALT = ['co\\.kr', 'or\\.kr', 'go\\.kr', ...(_TLDS.map(t => t))].join('|');
// 스킴 옵션 + 호스트(서브도메인 포함) + 알려진 TLD + 선택 경로/쿼리/프래그먼트
const _LINK_RE = new RegExp(
  '(https?:\\/\\/[^\\s<]+' +                                   // 1) 완전한 http(s) URL
  '|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + _TLD_ALT + ')' + // 2) 베어 호스트.TLD
  '(?:[\\/?#][^\\s<]*)?)',                                     //    선택 경로
  'gi'
);
export function linkify(escapedText) {
  if (!escapedText) return '';
  return String(escapedText).replace(_LINK_RE, (m) => {
    // 끝에 붙은 문장부호(이스케이프된 &quot; 등 포함)는 링크에서 제외
    let trail = '';
    let url = m;
    const mt = url.match(/(?:[.,!?)\]}'"]|&gt;|&quot;|&#39;|&amp;)+$/);
    if (mt) { trail = mt[0]; url = url.slice(0, url.length - trail.length); }
    if (!url) return m;
    const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
  });
}

/** 본문 텍스트를 안전하게 렌더(이스케이프 → 링크화 → 줄바꿈). */
export function renderBody(text) {
  return linkify(esc(text || '')).replace(/\n/g, '<br>');
}

/** Firestore Timestamp → "방금 / N분 전 / N시간 전 / N일 전 / 날짜" */
export function timeAgo(ts) {
  if (!ts) return '방금';
  const ms = ts.seconds ? ts.seconds * 1000 : (ts.toMillis ? ts.toMillis() : +new Date(ts));
  const diff = Date.now() - ms;
  if (diff < 60e3) return '방금';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}시간 전`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}일 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

/** 토스트 한 줄 알림 */
let _toastEl = null, _toastTimer = null;
export function toast(msg) {
  if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'toast'; document.body.appendChild(_toastEl); }
  _toastEl.textContent = msg;
  requestAnimationFrame(() => _toastEl.classList.add('show'));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 2200);
}

/** 작성자 아바타(익명=가면, 실명=닉네임 첫 글자, 사진 있으면 사진).
 *  익명 글/댓글에는 절대 사진을 노출하지 않는다(익명성 보호). */
export function avatarHTML(item, size = '') {
  const cls = `pa ${size}`.trim();
  const named = item.isOp || (!item.isAnonymous && item.authorNickname);
  // 사진은 익명이 아닌 경우에만 사용
  if (named && !item.isAnonymous && item.photoUrl) {
    return `<span class="${cls} hasimg"><img src="${esc(item.photoUrl)}" alt="" loading="lazy"></span>`;
  }
  if (named) {
    if (item.isOp) return `<span class="${cls} author">${esc((item.authorNickname || '글').slice(0, 1))}</span>`;
    return `<span class="${cls} named">${esc(item.authorNickname.slice(0, 1))}</span>`;
  }
  return `<span class="${cls} anon">${ANON_SVG}</span>`;
}

/** 페이스북식 이미지 그리드 (1~8장, 8장 초과는 8번째 타일에 +N 블러 오버레이) */
export function imageGridHTML(urls) {
  if (!urls || !urls.length) return '';
  const n = urls.length;
  const cls = n >= 8 ? 'g8' : `g${n}`;
  const shown = Math.min(n, 8);
  let cells = '';
  for (let i = 0; i < shown; i++) {
    const overlay = (i === shown - 1 && n > 8) ? `<div class="more-overlay">+${n - 8}</div>` : '';
    cells += `<div class="ph"><img src="${esc(urls[i])}" alt="" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1">${overlay}</div>`;
  }
  return `<div class="grid ${cls}">${cells}</div>`;
}

/** 피드 카드 1개 (a.post → post-detail.html?id=) */
export function postCardHTML(post) {
  const label = authorLabel(post);
  const badge = post.isAnonymous && !post.isOp ? ' <span class="badge-anon">익명</span>' : '';
  const metaBits = [boardName(post.board), timeAgo(post.createdAt)];
  if (post.rating) metaBits.push(`★ ${post.rating}`);
  const body = linkify(esc(post.content || ''));
  const clamp = (post.content || '').length > 160 ? ' clamp' : '';
  return `
  <a class="post" href="post-detail.html?id=${esc(post.id)}" data-id="${esc(post.id)}">
    <div class="post-head">
      ${avatarHTML(post)}
      <div>
        <div class="who">${esc(label)}${badge}</div>
        <div class="meta">${metaBits.map(esc).join(' · ')}</div>
      </div>
    </div>
    ${post.title ? `<h3>${esc(post.title)}</h3>` : ''}
    ${body ? `<p class="body${clamp}">${body.replace(/\n/g, '<br>')}</p>` : ''}
    ${post.imageCount > 0 ? `<div class="post-imgs" data-imgs-id="${esc(post.id)}" data-imgs-n="${post.imageCount}"></div>` : ''}
    <div class="actions">
      <span class="act like${post._liked ? ' liked' : ''}" role="button" data-like-id="${esc(post.id)}">${HEART}<span class="lc">${post.likeCount || 0}</span></span>
      <span class="act">${CHAT}${post.commentCount || 0}</span>
    </div>
  </a>`;
}

/** 빈 상태 placeholder */
export function emptyHTML(text) {
  return `<div style="text-align:center;color:var(--faint);font-size:14px;padding:60px 20px;line-height:1.6">${esc(text)}</div>`;
}

export { BOARDS, boardName, authorLabel, IMG_ICON };
