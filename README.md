# 유스나루 공간 예약 시스템

서울시립마포청소년센터 유스나루에서 사용하는 활동단별 공간 예약 시스템입니다.

🔗 https://youthnaroo.xyz

---

## Tech Stack

| 분류 | 기술 |
|------|------|
| Frontend | Vanilla JS (ES Modules), Tailwind CSS CDN |
| Database | Firebase Firestore (NoSQL, 실시간 구독) |
| Auth | Firebase Authentication (Email/Password) |
| Hosting | Firebase Hosting + Cloudflare (youthnaroo.xyz) |
| Push | OneSignal Web Push SDK v16 |
| Build | 빌드 없음 — 단일 HTML 파일 |

---

## Architecture

```
Browser
  └─ public/index.html          # 앱 전체 (SPA, 빌드 없음)
       ├─ env.js                # API 키 (gitignore, 로컬/배포 전용)
       ├─ Firebase SDK (ESM)    # Firestore + Auth
       └─ OneSignal SDK v16     # 웹 푸시

Firebase Hosting ──> Cloudflare ──> youthnaroo.xyz
Firestore (실시간 onSnapshot)
OneSignal REST API (예약/취소 시 push 전송)
```

---

## 주요 기술 구현

**실시간 동기화**  
Firestore `onSnapshot`으로 다수 클라이언트 간 예약 현황을 즉시 반영. 로그인/로그아웃 시 구독을 교체해 메모리 누수 방지.

**동시 예약 방지**  
Firestore `runTransaction`으로 같은 시간대 중복 예약을 원자적으로 차단.

**웹 푸시 알림**  
OneSignal SDK를 non-module `<script>`로 분리 초기화, 로그인 후 `external_id`로 사용자 식별. 예약·취소 시 REST API로 대상자에게 push 전송.

**접근 제어**  
활동단별 allowedTeams 필드로 예약 가능 공간 제한. 관리자는 특정 시간대를 특정 활동단 또는 지정 사용자 전용으로 잠금(room_blocks 컬렉션).

**환경 변수**  
`env.js`(gitignore)에 Firebase·OneSignal 키 분리. `env.example.js`를 복사해 값 채우면 바로 실행 가능.

---

## Firestore 컬렉션

```
reservations/{weekId}/{day}/{hour-room}   예약 데이터
fixed_schedules/{docId}                   고정 일정
room_blocks/{docId}                       전용 시간대 설정
users/{uid}                               사용자 프로필
teams/{docId}                             활동단 정보
notifications/{uid}/items/{docId}         인앱 알림
audit_logs/{docId}                        관리자 행동 로그
archive/{weekId}                          주간 예약 아카이브
```

---

## 로컬 실행

```bash
cp public/env.example.js public/env.js
# env.js에 Firebase · OneSignal 키 입력 후
open public/index.html
```

Firebase 없이 열면 데모 모드로 동작합니다 (새로고침 시 초기화).

---

## 배포

```bash
firebase deploy --only hosting
```

`public/env.js`는 gitignore되어 있지만 Firebase Hosting에는 포함됩니다.

---

## 기여자

<table>
  <tr>
    <td align="center">
      <img src="photos/yeowon.jpeg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="박여원"><br>
      <b>박여원</b><br>
      <sub>
        <!-- 기여 항목 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/chaeyeon.jpeg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="우채연"><br>
      <b>우채연</b><br>
      <sub>
        <!-- 기여 항목 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/eunseon.jpeg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="조은선"><br>
      <b>조은선</b><br>
      <sub>
        <!-- 기여 항목 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/minwoo.jpg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="조민우"><br>
      <b>조민우</b><br>
      <sub>
        <!-- 기여 항목 -->
      </sub>
    </td>
  </tr>
</table>

---

© 2026 서울시립마포청소년센터 유스나루
