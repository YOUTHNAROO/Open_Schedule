# 유스나루 활동단 공간 예약 시스템

서울시립마포청소년센터 유스나루에서 사용하는 활동단별 공간 예약 시스템이에요.  
활동단마다 쓸 수 있는 공간이랑 시간이 달라서, 실시간으로 확인하고 예약할 수 있도록 만들었습니다.

배포 주소: https://youthnaroo.xyz

---

## 이런 기능들이 있어요

- 요일·시간·공간별로 예약 현황을 한눈에 볼 수 있어요
- 같은 시간에 두 팀이 겹치는 일 없도록 동시 예약을 막아줘요
- 관리자는 고정 일정을 따로 등록하거나 특정 시간대를 특정 활동단 전용으로 잠글 수 있어요
- 예약하거나 취소하면 푸시 알림이 가요 (허용한 경우)
- 지난 주 예약 기록도 아카이브에서 볼 수 있어요
- 엑셀로 내보내기도 돼요

---

## 기술 스택

- Firebase Firestore (실시간 DB)
- Firebase Hosting (배포)
- Firebase Authentication
- OneSignal (웹 푸시 알림)
- Tailwind CSS (스타일)
- 별도 빌드 없이 단일 HTML 파일로 동작해요

---

## 로컬에서 열어보려면

그냥 `public/index.html`을 브라우저로 열면 돼요.  
Firebase 연결 없이는 데모 모드로 실행되고, 새로고침하면 데이터가 초기화돼요.

실제 운영용 Firebase 설정이 필요하다면 따로 연락주세요.

---

## 폴더 구조

```
public/
├── index.html              메인 앱
├── admin.html              관리자 전용 페이지
├── OneSignalSDKWorker.js   푸시 알림 서비스워커
└── firebase-config.js      Firebase 설정 (참고용)

photos/                     기여자 사진 폴더
```

---

## 배포

Firebase Hosting을 쓰고 있어요.

```bash
firebase deploy --only hosting
```

Cloudflare를 통해 youthnaroo.xyz 도메인으로 연결되어 있어요.

---

## 기여자

> 이 시스템을 함께 만들고 다듬어준 사람들이에요 🙌

<br>

<table>
  <tr>
    <td align="center">
      <img src="photos/park-yeowon.jpg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="박여원"><br>
      <b>박여원</b><br>
      <sub>
        <!-- 기여 항목을 여기에 적어주세요 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/woo-chaeyeon.jpg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="우채연"><br>
      <b>우채연</b><br>
      <sub>
        <!-- 기여 항목을 여기에 적어주세요 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/jo-eunseon.jpg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="조은선"><br>
      <b>조은선</b><br>
      <sub>
        <!-- 기여 항목을 여기에 적어주세요 -->
      </sub>
    </td>
    <td align="center">
      <img src="photos/jo-minwoo.jpg" width="80" height="80" style="border-radius:50%;object-fit:cover;" alt="조민우"><br>
      <b>조민우</b><br>
      <sub>
        <!-- 기여 항목을 여기에 적어주세요 -->
      </sub>
    </td>
  </tr>
</table>

<br>

---

© 2026 서울시립마포청소년센터 유스나루
