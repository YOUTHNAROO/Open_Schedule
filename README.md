# 🏫 유스나루 활동단 공간 예약 시스템

서울시립마포청소년센터 유스나루 활동단별 활동실 실시간 예약 시스템입니다.

---

## 📁 파일 구조

```
youthnaroo schedule/
├── index.html          ← 메인 앱 (이 파일 하나로 전체 실행)
├── firebase-config.js  ← Firebase 설정 (참고용)
└── README.md           ← 이 파일
```

---

## 🚀 빠른 시작 (데모 모드)

Firebase 설정 없이도 즉시 테스트할 수 있습니다.

1. `index.html` 파일을 브라우저로 열기
2. 상단의 노란 배너가 나타나면 **데모 모드**로 실행 중
3. 로그인 버튼을 눌러 활동단 선택 + 이름 입력 후 시작

> ⚠️ 데모 모드에서는 데이터가 브라우저 메모리에만 저장됩니다.  
> 새로고침하면 초기화됩니다. 실제 운영 시 아래 Firebase 설정을 진행하세요.

---

## 🔥 Firebase 연결 설정 (실제 운영용)

### 1단계: Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com) 접속
2. **프로젝트 추가** → 프로젝트 이름: `youthnaroo-schedule` (또는 원하는 이름)
3. Google Analytics: 선택 사항 (비활성화해도 무방)

### 2단계: Firestore 데이터베이스 활성화

1. 왼쪽 메뉴 → **Firestore Database** 클릭
2. **데이터베이스 만들기** 클릭
3. **테스트 모드로 시작** 선택 (나중에 보안 규칙 설정)
4. 리전: `asia-northeast3 (서울)` 선택 후 완료

### 3단계: 웹 앱 등록 및 Config 복사

1. Firebase Console → 프로젝트 설정 (⚙️ 아이콘)
2. **내 앱** 섹션 → 웹 아이콘(`</>`) 클릭
3. 앱 닉네임 입력 후 **앱 등록**
4. 아래와 같은 `firebaseConfig` 코드가 나타납니다:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc..."
};
```

### 4단계: index.html에 Config 붙여넣기

`index.html` 파일을 텍스트 에디터로 열고, 다음 부분을 찾아 교체하세요:

```javascript
// 변경 전 (약 35번째 줄)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    ...
};

// 변경 후
const firebaseConfig = {
    apiKey: "AIza...",           // Firebase에서 복사한 값
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123...:web:abc..."
};
```

### 5단계: Firestore 보안 규칙 설정

Firebase Console → Firestore → **규칙** 탭에서 아래 규칙을 붙여넣으세요:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 예약 데이터: 모든 사용자 읽기/쓰기 가능 (앱에서 권한 제어)
    match /reservations/{weekId}/{day}/{docId} {
      allow read, write: if true;
    }
    // 고정 일정: 모든 사용자 읽기 가능
    match /fixed_schedules/{docId} {
      allow read: if true;
      allow write: if true; // 앱에서 관리자 권한 제어
    }
    // 활동단 데이터: 읽기 전용 (공개)
    match /teams/{docId} {
      allow read: if true;
      allow write: if true;
    }
    // 감사 로그: 읽기/쓰기 가능
    match /audit_logs/{docId} {
      allow read, write: if true;
    }
    // 아카이브: 읽기/쓰기 가능
    match /archive/{docId} {
      allow read, write: if true;
    }
  }
}
```

> 📌 위 규칙은 운영 환경에서 적합합니다. 민감한 데이터가 있다면 추가 인증 설정을 권장합니다.

---

## 🔑 관리자 비밀번호 변경

`index.html` 파일에서 다음 줄을 찾아 변경하세요:

```javascript
const ADMIN_PASSWORD = "youthnaroo2026!";
```

원하는 비밀번호로 변경한 뒤 저장하면 됩니다.

---

## 🌐 배포 방법 (선택사항)

로컬 파일 대신 온라인으로 배포하려면:

### Firebase Hosting (무료, 권장)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

### GitHub Pages
1. GitHub 저장소 생성
2. `index.html` 업로드
3. Settings → Pages → Branch: main 설정

---

## 📊 Firestore 데이터 구조

```
Firestore
├── reservations/
│   └── {weekId}/              예: "2026-W22"
│       └── {day}/             예: "sat"
│           └── {hour-room}: {
│               teamId: "narujigi",
│               teamName: "나루지기",
│               userName: "홍길동",
│               isFixed: false,
│               createdAt: Timestamp
│           }
│
├── fixed_schedules/
│   └── {docId}: {
│       teamId: "narujigi",
│       teamName: "나루지기",
│       day: "sat",
│       hour: "14:00",
│       room: "나루지기실",
│       note: "2,4,5주 고정",
│       createdBy: "관리자",
│       createdAt: Timestamp
│   }
│
├── audit_logs/
│   └── {docId}: {
│       adminName: "관리자이름",
│       action: "예약_강제취소",
│       target: "sat 14:00 나루지기실",
│       before: { ... },
│       after: null,
│       timestamp: Timestamp
│   }
│
└── archive/
    └── {weekId}: {
        data: { sat: { ... }, sun: { ... }, ... },
        archivedAt: Timestamp,
        archivedBy: "관리자이름"
    }
```

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 🔑 간편 로그인 | 활동단 선택 + 이름 입력만으로 로그인 |
| 👑 관리자 모드 | 비밀번호 입력으로 관리자 권한 활성화 |
| ⚡ 실시간 동기화 | Firebase Firestore onSnapshot으로 즉시 반영 |
| 🔒 중복 예약 방지 | Firestore 트랜잭션으로 동시 예약 차단 |
| 📌 고정 일정 | 관리자 전용 고정 일정 추가/삭제 |
| 📋 감사 로그 | 관리자 행동 이력 자동 기록 |
| 📊 엑셀 내보내기 | 전체 주간 예약 .xlsx 다운로드 |
| 🔄 주간 리셋 | 일반 예약 초기화 (과거 기록 보관) |

---

## ❓ 문의

기능 추가나 오류 문의는 시스템 담당자에게 연락하세요.

© 2026 서울시립마포청소년센터 유스나루
