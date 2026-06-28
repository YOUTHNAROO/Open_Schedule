# 커뮤니티 서버 연동 가이드

UI 목업(Open Design)에서 `community-data.js`를 import 해 호출하면 된다. 모든 함수는 `window.ENV`(env.js)에 Firebase 키가 있어야 동작한다.

```html
<script type="module">
  import * as Community from './community-data.js';
  // 또는 필요한 것만: import { subscribeFeed, createPost } from './community-data.js';
</script>
```

> **계정/세션 (SSO):** 커뮤니티는 **본체(시간표)의 아이디·비밀번호·세션을 그대로 공유**한다. 별도 계정 없음.
> - 동일 Firebase 프로젝트(`youthnarooschedule`) + Auth 기본 LOCAL 지속성 → 같은 도메인(youthnaroo.xyz)에 올리면 본체 로그인이 자동 공유된다.
> - 닉네임·권한은 기존 `users/{uid}`(`displayName`, `role`)에서 읽는다. 로그인은 본체에서만(`username`→`username@youthnaroo.local`).
> - 페이지 진입 시 최상단에서 한 줄로 가드: `const me = await requireLoginOrRedirect();` (미로그인 시 본체 `/`로 이동, 로그인 후 `?return=`으로 복귀).
>
> **전제:** 커뮤니티 페이지도 `index.html`처럼 `window.ENV`(env.js)가 선행돼야 한다.

## 화면별 매핑

| 목업 | 호출 |
|------|------|
| `home.html` (피드) | `subscribeFeed(board, posts => render(posts))`, 탭 전환 시 board 교체. 무한스크롤은 `fetchFeedPage(board, lastCreatedAt)` |
| `write.html` (글쓰기) | `createPost({ board, title, content, isAnonymous, imageFiles })`. `BOARDS[board].anonOnly`(비밀게시판)면 익명 강제 — UI 토글도 잠금 |
| `post-detail.html` | `getPost(id)`, `subscribeComments(id, cb)`, `addComment(id, {content, isAnonymous})`, `toggleLike(id)`, `toggleScrap(id)`, `reportPost(id, reason)`. 작성자 라벨은 `authorLabel(item)` (작성자/익명 N/닉네임) |
| `board.html` (디렉터리) | `BOARDS` 로 기본 게시판 렌더. 활동 채널·카운트는 `community_boards` 컬렉션(`subscribe` 추가 필요 시 확장) |
| `meetup.html` | `subscribeMeetups(cb)`, `createMeetup({title,time,location,capacity})`, `toggleMeetupJoin(id)` |
| `notifications.html` | `subscribeNotifications(cb)`, `markAllNotificationsRead()` |
| `profile.html` | `getProfileStats()`, `getMyPosts()`(익명 글 포함, 본인만), `getMyScraps()` |
| 관리자(어드민 콘솔) | `deanonymizePost(id, 사유)` (작성자 조회 + activity_logs 기록), `adminSetPostStatus(id, 'BLINDED'|'ACTIVE')` |

## 익명 표시 규칙 (UI 적용)
- 게시글/댓글 객체에 `authorLabel(item)` 사용.
- `item.isOp === true` → "작성자"(글쓴이 뱃지), `item.isAnonymous && anonNum` → "익명 N", 그 외 → `authorNickname`.
- 익명 글에는 실제 식별값이 클라이언트로 내려오지 않는다(서버 보장). 관리자만 `deanonymizePost`로 조회.

## 배포 순서 (사용자 실행)
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage   # 규칙·인덱스 먼저
firebase deploy --only hosting                                      # 정적 파일
```
- 인덱스 생성은 수 분 소요. 생성 전 `getMyPosts`/`getMyScraps`/피드 쿼리가 인덱스 오류를 던지면 콘솔 링크로 생성하거나 위 배포를 기다린다.
- 규칙 변경은 기존 예약 시스템 컬렉션 동작을 그대로 보존한다(전역 catch-all → 컬렉션별 재귀 와일드카드로 분리).

## 한계 / 후속 하드닝 (선택, Cloud Functions = Blaze 필요)
- **자동 블라인드:** 현재 `reportPost`는 `reportCount`만 증가시키고 `status` 변경은 관리자만 가능(클라가 임의 블라인드 못함). 신고 ≥5 자동 블라인드는 `onDocumentWritten` 트리거로 이관하면 자동화된다.
- **De-anon 감사 로그:** `activity_logs` 기록은 클라이언트 기반이라 "무결성 강제"는 아니다. WORM 수준이 필요하면 callable Function 경유로 전환.
- **레이트 리밋:** 현재 보안 규칙 + App Check 권장. 강한 도배 차단이 필요하면 Function 카운터.
