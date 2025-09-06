/// <reference types="vite/client" />
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";

function must(name: string, v: string | undefined): string {
  if (!v || v.trim() === "") throw new Error(`[firebase] Missing env: ${name}`);
  return v;
}

const firebaseConfig = {
  apiKey: must("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: must("VITE_FIREBASE_AUTH_DOMAIN", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  databaseURL: must("VITE_FIREBASE_DATABASE_URL", import.meta.env.VITE_FIREBASE_DATABASE_URL),
  projectId: must("VITE_FIREBASE_PROJECT_ID", import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: must("VITE_FIREBASE_STORAGE_BUCKET", import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: must("VITE_FIREBASE_MESSAGING_SENDER_ID", import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: must("VITE_FIREBASE_APP_ID", import.meta.env.VITE_FIREBASE_APP_ID),
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export async function ensureAuth() { if (!auth.currentUser) await signInAnonymously(auth); return auth.currentUser; }
