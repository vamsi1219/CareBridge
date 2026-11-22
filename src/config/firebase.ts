import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  disableNetwork,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';

const env = typeof process !== 'undefined' && process.env ? process.env : {};

// Config comes from EXPO_PUBLIC_FIREBASE_* keys with fallbacks from .env.example for bare RN CLI.
const config = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCEbizg3jQgETJWqWhm6BfMA3SNW5g6ZdA',
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'care-bridge-e3734.firebaseapp.com',
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'care-bridge-e3734',
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'care-bridge-e3734.firebasestorage.app',
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '293170314814',
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:293170314814:android:149d054d9ea75f4e359b6f',
};

let cachedDb: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(config);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseDb(): Firestore {
  if (cachedDb) return cachedDb;
  const firebaseApp = getFirebaseApp();
  try {
    // Force long polling in React Native so WebChannel XHR streaming does not hang.
    cachedDb = initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
    });
  } catch {
    cachedDb = getFirestore(firebaseApp);
  }
  if (typeof XMLHttpRequest === 'undefined') {
    void disableNetwork(cachedDb).catch(() => {});
  }
  return cachedDb;
}

export const app: FirebaseApp = getFirebaseApp();
export const auth: Auth = getFirebaseAuth();
export const db: Firestore = getFirebaseDb();
