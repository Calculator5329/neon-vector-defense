// Anonymous Firebase Auth on the PLAYER path. firestore.rules requires
// request.auth on every player write, so writes must be preceded by a
// signed-in session. firebase/auth is imported DYNAMICALLY so it stays out of
// the eager player bundle (see vite.config.ts) — sign-in happens lazily right
// before the first server write, never at boot.
//
// Requires the Anonymous provider to be enabled in the Firebase console
// (Authentication -> Sign-in method -> Anonymous), or every player write fails.
import { app } from './firebaseClient';
import type { User } from 'firebase/auth';

const CACHED_UID_KEY = 'nvd-server-uid-v1';

let signInPromise: Promise<string | null> | null = null;
let knownUid: string | null = null;

// Stored as JSON so the /privacy export (which JSON.parses each key) includes it.
function readCachedUid(): string | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHED_UID_KEY) ?? 'null');
    return typeof parsed === 'string' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUid(uid: string): void {
  try {
    localStorage.setItem(CACHED_UID_KEY, JSON.stringify(uid));
  } catch {
    // private-mode storage failures must never block a write path
  }
}

/**
 * Last known server uid, synchronously. Used for UI concerns like leaderboard
 * "me" highlighting; it is populated after the first successful sign-in and
 * cached across sessions. Never trusted server-side.
 */
export function cachedServerUid(): string | null {
  if (knownUid) return knownUid;
  knownUid = readCachedUid();
  return knownUid;
}

/**
 * Resolve the authenticated anonymous uid, signing in if needed.
 * Waits for auth-state restore before deciding to sign in — calling
 * signInAnonymously before restore completes would mint a NEW anonymous
 * user every session instead of reusing the persisted one.
 * Returns null (and allows a later retry) when auth is unavailable.
 */
export function ensureServerUid(): Promise<string | null> {
  if (!signInPromise) {
    signInPromise = (async () => {
      try {
        const { getAuth, onAuthStateChanged, signInAnonymously } = await import('firebase/auth');
        const auth = getAuth(app);
        const restored = await new Promise<User | null>((resolve) => {
          const unsub = onAuthStateChanged(auth, (user) => {
            unsub();
            resolve(user);
          }, () => {
            unsub();
            resolve(null);
          });
        });
        // A persisted anonymous session can outlive its account — the user is
        // deleted or expires server-side, but onAuthStateChanged still restores
        // the cached user object. Firestore then can't refresh a valid ID token,
        // so request.auth is empty and EVERY uid-bound write (replayStreams,
        // replayOwners, runAnalytics) is rejected with permission-denied even
        // though the rules are correct. Force a token refresh to prove the
        // session is live; if it fails, discard it and mint a fresh anonymous
        // user so the client self-heals on the next load instead of getting
        // permanently stuck unable to save.
        let user = restored;
        if (user) {
          try {
            await user.getIdToken(true);
          } catch {
            user = null;
          }
        }
        const uid = user?.uid ?? (await signInAnonymously(auth)).user.uid;
        knownUid = uid;
        writeCachedUid(uid);
        return uid;
      } catch (error) {
        console.warn('Anonymous sign-in failed', error);
        signInPromise = null; // allow the next write attempt to retry
        return null;
      }
    })();
  }
  return signInPromise;
}
