// Firestore client on the PLAYER path. Deliberately imports only firebase/app +
// firebase/firestore — the (heavy) firebase/auth SDK lives in ./adminAuth and is
// pulled in only by the lazy-loaded admin dashboard, keeping it off every player's
// download. Firebase web config is public by design; access control is in firestore.rules.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAxKfk-rZAFLS7OeqCqIFEzNYKlv3tdrhs',
  authDomain: 'neon-vector-defense-7.firebaseapp.com',
  projectId: 'neon-vector-defense-7',
};

export const app = initializeApp(firebaseConfig);

const viteEnv = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
const appCheckSiteKey = viteEnv?.VITE_FIREBASE_APPCHECK_SITE_KEY;
const appCheckDebugToken = viteEnv?.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;

if (appCheckSiteKey) {
  if (viteEnv?.DEV && appCheckDebugToken) {
    (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const db = getFirestore(app);
