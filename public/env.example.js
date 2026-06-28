// 환경 변수 예시 파일 — env.js로 복사한 뒤 실제 값을 채워주세요.
// Firebase Console (https://console.firebase.google.com) 및
// OneSignal Dashboard (https://dashboard.onesignal.com) 에서 확인할 수 있습니다.
window.ENV = {
  // Firebase (Firebase Console > 프로젝트 설정 > 내 앱)
  FIREBASE_API_KEY: "YOUR_FIREBASE_API_KEY",
  FIREBASE_AUTH_DOMAIN: "YOUR_PROJECT_ID.firebaseapp.com",
  FIREBASE_DATABASE_URL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  FIREBASE_PROJECT_ID: "YOUR_PROJECT_ID",
  FIREBASE_STORAGE_BUCKET: "YOUR_PROJECT_ID.firebasestorage.app",
  FIREBASE_MESSAGING_SENDER_ID: "YOUR_MESSAGING_SENDER_ID",
  FIREBASE_APP_ID: "YOUR_FIREBASE_APP_ID",
  FIREBASE_MEASUREMENT_ID: "YOUR_MEASUREMENT_ID",

  // Supabase (supabase.com > Project Settings > API Keys > Legacy anon)
  SUPABASE_URL: "https://YOUR_PROJECT_ID.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",

  // OneSignal — APP_ID만 클라이언트에 둔다. REST 키는 서버 시크릿으로:
  //   supabase secrets set ONESIGNAL_REST_API_KEY=... ONESIGNAL_APP_ID=...
  ONESIGNAL_APP_ID: "YOUR_ONESIGNAL_APP_ID",
};
