const admin = require('firebase-admin');

// Firebase Admin SDK 초기화
admin.initializeApp({
  projectId: 'youthnarooschedule'
});

const db = admin.firestore();

async function run() {
  try {
    const docRef = db.collection('system_settings').doc('google_sheets');
    const snap = await docRef.get();
    if (!snap.exists) {
      console.log('No settings doc found in Firestore.');
      return;
    }
    const data = snap.data();
    console.log('--- Firestore Settings ---');
    console.log('gasWebAppUrl:', data.gasWebAppUrl);
    console.log('activeTabName:', data.activeTabName);
    
    if (data.gasWebAppUrl) {
      console.log('\n--- Fetching from GAS Web App ---');
      const url = `${data.gasWebAppUrl}?activeTabName=${encodeURIComponent(data.activeTabName)}`;
      console.log('Fetching:', url);
      const res = await fetch(url);
      const json = await res.json();
      console.log('GAS Response Status:', res.status);
      console.log('GAS Response JSON:', JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.error('Error running test:', err);
  }
}

run();
