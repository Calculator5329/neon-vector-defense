// Firebase app bootstrap on the PLAYER path. Deliberately imports only
// firebase/app (+ optional app-check) — the heavy SDKs load lazily elsewhere:
// firebase/firestore through ./firestoreLazy on first data access, and
// firebase/auth through ./anonAuth (player sign-in) / ./adminAuth (admin
// chunk). Firebase web config is public by design; access control is in
// firestore.rules.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

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

