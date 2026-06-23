import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc,
    onSnapshot, query, orderBy, runTransaction, serverTimestamp,
    writeBatch, where, limit, addDoc, arrayUnion, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, EmailAuthProvider,
    reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: window.ENV.FIREBASE_API_KEY,
    authDomain: window.ENV.FIREBASE_AUTH_DOMAIN,
    databaseURL: window.ENV.FIREBASE_DATABASE_URL,
    projectId: window.ENV.FIREBASE_PROJECT_ID,
    storageBucket: window.ENV.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.ENV.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.ENV.FIREBASE_APP_ID,
    measurementId: window.ENV.FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Supabase 마이그레이션 후 Auth 관련만 사용 중
// initializeApp/getAuth/getFirestore는 auth.js 보조 앱 생성용으로 export
export {
    app, db, auth, deleteApp,
    initializeApp, getAuth, getFirestore,
    collection, doc, setDoc, getDoc, getDocs, deleteDoc,
    onSnapshot, query, orderBy, runTransaction, serverTimestamp,
    writeBatch, where, limit, addDoc, arrayUnion, updateDoc,
    signInWithEmailAndPassword, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, EmailAuthProvider,
    reauthenticateWithCredential, updatePassword
};
