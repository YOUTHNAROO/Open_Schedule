/**
 * 유스나루 실시간 예약 시스템 - Firebase 설정
 * 
 * ⚠️ 중요: 이 파일의 설정값을 본인의 Firebase 프로젝트 정보로 교체하세요.
 * README.md 의 가이드를 참고하세요.
 */

// 🔧 여기에 본인의 Firebase 프로젝트 설정을 입력하세요:
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA1XuuCYE2RnipFHQ0d9dCjGNlPtgwvWmw",
  authDomain: "youthnarooschedule.firebaseapp.com",
  databaseURL: "https://youthnarooschedule-default-rtdb.firebaseio.com",
  projectId: "youthnarooschedule",
  storageBucket: "youthnarooschedule.firebasestorage.app",
  messagingSenderId: "53441811066",
  appId: "1:53441811066:web:cc3604e124ca94778ca1c3",
  measurementId: "G-ME8HDTV2FV"
};

// Firebase 초기화 여부 확인 (설정이 기본값이면 데모 모드로 동작)
const IS_DEMO_MODE = firebaseConfig.apiKey === "YOUR_API_KEY";

export { firebaseConfig, IS_DEMO_MODE };
