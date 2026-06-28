# Google Apps Script 연동 가이드

이 문서는 기존 Google 스프레드시트 수정 사항을 `https://youthnaroo.xyz` 예약 페이지에 실시간으로 반영하기 위한 설정 안내입니다.

## 목표 흐름

```text
Google Sheets 수정
-> Apps Script 설치형 onEdit 트리거 실행
-> Firestore reservations 문서 업데이트
-> youthnaroo.xyz 웹페이지 onSnapshot으로 실시간 반영
```

웹에서 예약/취소하는 경우도 반대로 동작합니다.

```text
youthnaroo.xyz 예약/취소
-> Firestore 저장
-> Apps Script doPost 호출
-> Google Sheets 셀 수정
```

## 사용할 코드

Apps Script 편집기에는 이 프로젝트의 아래 파일 내용을 그대로 붙여넣습니다.

```text
google-apps-script.js
```

현재 코드의 기본 설정값은 아래와 같습니다.

```javascript
var PROJECT_ID = "youthnarooschedule";
var SECRET_API_TOKEN = "youthnaroo_secret_token_2026";
```

관리자 페이지의 Google Sheets 설정에 저장하는 API 토큰도 같은 값이어야 합니다.

### 시트 색상으로 담당자 자동 지정

원본 스프레드시트의 셀 배경색을 담당자명으로 매핑하려면 `google-apps-script.js` 상단의 `SHEET_COLOR_OWNERS`에 색상 HEX 값을 추가합니다.

```javascript
var SHEET_COLOR_OWNERS = {
  "#fce8b2": "평생학습팀 장지혜",
  "#d9ead3": "생활체육팀 김동진"
};
```

이후 전체 동기화 또는 시트 직접 수정 시 웹 예약 데이터에 `sheetColor`, `sheetOwner`가 함께 저장됩니다. 웹에서는 예약 상세 설정에서 시트 색상과 담당자를 확인할 수 있습니다.

## 설정 순서

1. 연동할 Google 스프레드시트를 엽니다.
2. 상단 메뉴에서 `확장 프로그램` -> `Apps Script`를 엽니다.
3. `Code.gs`의 기존 내용을 모두 지우고 `google-apps-script.js` 전체 내용을 붙여넣습니다.
4. Apps Script 왼쪽의 `프로젝트 설정`으로 이동합니다.
5. `appsscript.json 매니페스트 파일 표시`를 켭니다.
6. `appsscript.json`에 이 프로젝트의 `appsscript.json` 내용을 붙여넣습니다.
7. 저장합니다.
8. 상단 `배포` -> `새 배포`를 누릅니다.
9. 유형은 `웹 앱`을 선택합니다.
10. `웹 앱을 실행할 사용자`는 `나`로 설정합니다.
11. `액세스 권한이 있는 사용자`는 `모든 사용자`로 설정합니다.
12. 배포 후 나오는 웹 앱 URL을 복사합니다.
13. `https://youthnaroo.xyz/admin` 관리자 페이지로 이동합니다.
14. `구글 시트 연동` 메뉴에서 아래 값을 저장합니다.
    - 스프레드시트 ID
    - Apps Script 웹 앱 URL
    - API 토큰
    - 연동할 시트 탭 이름
15. Apps Script 왼쪽의 `트리거` 메뉴로 이동합니다.
16. `트리거 추가`를 누릅니다.
17. 아래처럼 설정합니다.
    - 실행할 함수: `onEdit`
    - 실행할 배포: `Head`
    - 이벤트 소스: `스프레드시트`
    - 이벤트 유형: `수정 시`
18. 권한 승인 화면이 나오면 승인합니다.

## 필수 매니페스트

Apps Script의 `appsscript.json`은 아래 권한을 포함해야 합니다.

```json
{
  "timeZone": "Asia/Seoul",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/datastore",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets.currentonly"
  ]
}
```

`datastore` 권한이 빠지면 Apps Script가 Firestore REST API로 예약 문서를 쓰지 못합니다.

## 병합 셀 처리 방식

스프레드시트 병합 셀은 그대로 사용할 수 있습니다.

- `doGet`: 병합 영역의 좌상단 값을 병합 범위 전체에 채워서 읽습니다.
- `onEdit`: 병합 셀을 수정하면 병합 범위 안의 모든 시간/공간 칸을 Firestore 문서로 각각 업데이트합니다.
- 빈 값으로 지우면 해당 예약 문서를 삭제합니다.

예를 들어 `09:00~11:00`처럼 2칸 이상 병합된 예약을 `체육관` 열에 입력하면 웹에서는 `09:00`, `10:00` 칸이 예약된 것처럼 반영됩니다.

## 확인된 스프레드시트 구조

현재 공유된 스프레드시트는 한 탭 안에 요일별 블록이 세로로 이어지는 구조입니다.

- 요일 블록: 월요일, 화요일, 수요일, 목요일, 금요일, 토요일, 일요일
- 시간 열: A열
- 공간 열: B열부터 X열까지 23개 공간
- Y열 이후: `1월`~`12월` 월별 참고/부가 컬럼으로 보이며 웹 예약표 공간으로 쓰지 않습니다.

웹 예약표에 맞춘 공간 목록은 아래와 같습니다.

```text
체육관
건강나루
피아노나루
소리나루
상상나루
생각나루
창의나루
세미나실
키움나루
사랑나루
나루지기
멀티미디어
콤마
콤마 스튜디오
링키
행복나루
동행나루
신나루
빛나루
미디어나루
방송나루
스튜디오M
스튜디오H
```

웹 예약표에 맞춘 시간 목록은 아래와 같습니다.

```text
09:00
10:00
11:00
12:00
13:00
14:00
15:00
16:00
17:00
18:00
19:00
20:00
21:00
```

일요일처럼 실제 시트에 일부 시간만 있어도 웹은 전체 시간대를 표시하고, 데이터가 없는 칸은 빈 칸으로 둡니다.

## 테스트 방법

### 1. 탭 목록 확인

관리자 페이지의 `구글 시트 연동`에서 `탭 목록 불러오기`를 누릅니다.

성공하면 Apps Script 웹 앱 URL 연결은 정상입니다.

### 2. 전체 동기화 확인

관리자 페이지에서 `시트 -> 웹 전체 동기화 실행`을 누릅니다.

Firestore에 아래 형태의 문서가 생겨야 합니다.

```text
reservations/{현재 weekId}/{day}/{시작시간-공간명}
예: reservations/2026-W25/sat/09:00-체육관
```

### 3. 실시간 수정 확인

스프레드시트 예약 칸 하나를 수정합니다.

몇 초 안에 `https://youthnaroo.xyz` 예약표에 같은 내용이 보이면 정상입니다.

## 문제 해결

### Apps Script 실행은 완료인데 웹에 안 보일 때

아래를 확인합니다.

- Apps Script 코드가 최신 `google-apps-script.js`로 교체됐는지 확인
- 새 버전으로 웹 앱을 다시 배포했는지 확인
- `onEdit`가 단순 트리거가 아니라 설치형 트리거인지 확인
- `appsscript.json`에 `datastore` 권한이 있는지 확인
- 관리자 페이지에 저장한 탭 이름이 실제 시트 탭 이름과 같은지 확인

### Firestore에는 있는데 웹에 안 보일 때

웹의 공간/시간 목록과 시트 값이 맞는지 확인합니다.

- 웹 시간 목록: `index.html`의 `HOURS`
- 웹 공간 목록: `index.html`의 `FLOORS`

스프레드시트 공간명이 웹의 `FLOORS`에 없으면 Firestore에는 저장돼도 화면에는 보이지 않습니다.

### 시간대가 안 맞을 때

코드는 `09:00~09:50` 같은 값을 `~` 기준으로 잘라 `09:00`으로 저장합니다.

시트 A열의 시작 시간이 웹의 `HOURS` 값과 같아야 합니다.

```javascript
const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
```

### 공간명에 `/`가 있을 때

코드는 Firestore 문서 ID 오류를 막기 위해 `/`를 `_`로 바꿉니다.

```javascript
var resId = (cleanTime + "-" + curRoom).replace(/\//g, "_");
```

## 운영 체크리스트

- `google-apps-script.js` 최신 코드 붙여넣기 완료
- `appsscript.json` 권한 설정 완료
- 웹 앱 새 배포 완료
- 관리자 페이지에 Apps Script 웹 앱 URL 저장 완료
- 활성 시트 탭 이름 저장 완료
- `onEdit` 설치형 트리거 등록 완료
- 시트 칸 수정 후 `youthnaroo.xyz` 실시간 반영 확인 완료
