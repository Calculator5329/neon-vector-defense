// Single lazy entry to the Firestore SDK on the player path. The SDK is
// ~88KB gzip — a third of first-paint JS — and no player needs it before the
// first leaderboard read / remote-balance fetch / replay write, all of which
// are already async and fire-and-forget. Importing it dynamically (and keeping
// it OUT of the eager 'firebase' manual chunk — see vite.config.ts) moves that
// weight off first paint entirely.
import { app } from './firebaseClient';

export type FirestoreNS = typeof import('firebase/firestore');

export interface FirestoreHandle {
  /** the full firebase/firestore namespace (doc, getDoc, writeBatch, ...) */
  fs: FirestoreNS;
  db: import('firebase/firestore').Firestore;
}

let handle: Promise<FirestoreHandle> | null = null;

export function firestore(): Promise<FirestoreHandle> {
  return (handle ??= import('firebase/firestore').then((fs) => ({ fs, db: fs.getFirestore(app) })));
}
