# 배포 전 필수 작업 (이번 변경분)

이번 작업으로 **관리자 페이지가 Firestore → Supabase로 통일**되고, **부서/표시명/청소년·직원** 기능과 다수 커뮤니티 기능이 추가되었습니다. 라이브 반영 전 아래를 순서대로 진행하세요.

## 1. Supabase 스키마 마이그레이션 (필수)
Supabase 대시보드 → SQL Editor에서 `supabase/migration_community.sql` 전체를 1회 실행.
- `teams.dept_config`(부서 설정), `teams.short_name`, `invite_codes.meta`(초대 메타) 컬럼 추가.
- ⚠️ **이걸 먼저 안 하면 활동단 저장/초대코드 발급이 컬럼 없음 오류로 실패**합니다.

## 2. Supabase Edge Function 배포 (완전삭제·관리자 비번재설정용)
`supabase/functions/admin-auth/index.ts` — Firebase Auth 계정 삭제/비번변경은 클라이언트에서 불가하므로 서버 함수로 처리.
```bash
supabase functions deploy admin-auth --no-verify-jwt
supabase secrets set FIREBASE_PROJECT_ID=youthnarooschedule
supabase secrets set FIREBASE_API_KEY=<env.js의 FIREBASE_API_KEY>
supabase secrets set FIREBASE_SERVICE_ACCOUNT='<Firebase 서비스계정 JSON 전체>'
supabase secrets set SUPABASE_URL=<프로젝트 URL>
supabase secrets set SERVICE_ROLE_KEY=<service_role 키>
```
서비스계정 JSON: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성.
- 미배포 시: 사용자 **소프트삭제/재활성화/생성/수정**은 정상. **완전삭제**와 **관리자의 타인 비번변경**만 "함수 미배포" 오류가 납니다(나머지 기능엔 영향 없음).

## 3. RLS 정책 확인 (권장)
앱은 Firebase Auth 세션 + Supabase anon 키로 동작합니다. 관리자 기능이 작동하려면 anon 역할이
`app_users` 전체 SELECT, `teams`/`invite_codes` INSERT/UPDATE/DELETE가 가능해야 합니다.
(기존에 회원가입/예약이 동작했다면 대체로 허용 상태) 관리자 사용자 목록이 비어 보이면 RLS부터 확인.

## 4. 캐시 무효화
커뮤니티 모듈 버전을 `?v=8 → ?v=9`로 올렸습니다. 배포 후 **Cloudflare 캐시 퍼지** 또는 `.web.app`에서 먼저 테스트.

## 5. 로그인 버그 자가복구
메인앱/관리자 로그인 모두, Supabase에 계정이 없으면 레거시 Firestore(`users`/`user_recovery`)에서
**첫 로그인 시 자동 이관**합니다. 별도 일괄 이관 스크립트는 불필요(레거시 Firestore 읽기 규칙만 허용돼 있으면 됨).

---
## 추가 수정분 (로그인/회원가입/커뮤니티/캘린더 버그)

### A. 코드만 반영하면 되는 항목 (인프라 작업 불필요)
- **초대코드 발급 실패 수정**: 발급 시 존재하지 않는 `invite_codes.created_by` 컬럼에 쓰려다 INSERT가 실패하던 버그 제거. → 발급/회원가입 정상화. (DB 스키마 변경 불필요)
- **연락처 자동 하이픈**: `01000000000` → `010-0000-0000` 자동 변환(회원가입·관리자 사용자 폼 모두).
- **캘린더 주차 표시**: `2026-W26` → `6월 4주차` 형식(해당 달의 N번째 주).
- **모바일 캘린더**: 모바일에서 '달력' 버튼이 캘린더를 **플로팅 오버레이(+백드롭)**로 띄우도록 변경. 터치 중복(ghost click) 디바운스 추가.
- **커뮤니티 닉네임**: 닉네임 미설정 시 `활동단/부서/이름`(학과)이 노출되던 것을 제거 → 닉네임 없으면 접두어 없는 '이름'만 표시.
- **커뮤니티 → 시간표 버튼**: 커뮤니티 home 상단에 시간표(`../index.html`)로 가는 버튼 추가.

### B. ⚠ Edge Function 재배포 필요 (admin-auth)
`supabase/functions/admin-auth/index.ts`에 액션 2개 추가됨:
- `lookupUserByEmail` — 관리자가 삭제됐던 아이디로 사용자 재생성 시, 잔존 Firebase Auth UID 회수용.
- `reclaimDormantAccount` — **탈퇴/삭제 후 같은 아이디로 본인 재가입**을 가능하게 함(인증 불필요하지만, *유효한 미사용 초대코드* + *대상 계정이 비활성/없음*일 때만 허용 → 활성 계정 탈취 방지).

```bash
supabase functions deploy admin-auth --no-verify-jwt
```
- 미배포 시: 일반 회원가입/로그인/시트연동/캘린더 등은 정상. **삭제된 아이디로의 재가입**과 **관리자의 삭제아이디 재생성**만 "함수 미배포" 오류가 납니다(재배포하면 해결). 비밀번호 재설정용 시크릿(2번 항목)이 이미 설정돼 있으면 추가 시크릿은 불필요.

---
## 보류 항목
- **커뮤니티 React 전면 재작성**: 단일 세션에서 안전하게 완료 불가(8화면+실시간/익명/이미지/채팅/모더레이션 + 빌드툴 도입)로 별도 이니셔티브로 보류. 단, React 전환의 실제 동기였던 **모바일 드래그 버그는 바닐라에서 수정 완료**(home.html pointer 핸들러: preventDefault/pointercancel/touch-action).
- **OneSignal REST 키 노출**(`public/env.js`): 별도 보안 과제로 잔존(서버 발송 이전 시 해결).
