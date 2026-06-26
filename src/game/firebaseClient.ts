// Firestore client on the PLAYER path. Deliberately imports only firebase/app +
// firebase/firestore — the (heavy) firebase/auth SDK lives in ./adminAuth and is
// pulled in only by the lazy-loaded admin dashboard, keeping it off every player's
// download. Firebase web config is public by design; access control is in firestore.rules.
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAxKfk-rZAFLS7OeqCqIFEzNYKlv3tdrhs',
  authDomain: 'neon-vector-defense-7.firebaseapp.com',
  projectId: 'neon-vector-defense-7',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
