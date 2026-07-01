// Admin-only Firebase Auth + feedback moderation. Imported ONLY by the lazy-loaded
// AdminDashboard, so the heavy firebase/auth SDK is code-split off the player path.
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { isAdminEmail } from '../../functions/src/adminEmails';
import { app } from './firebaseClient';

export const auth = getAuth(app);
// Static firestore import is fine here: this module lives in the lazy admin
// chunk, so it never adds SDK weight to the player's first paint.
const db = getFirestore(app);

export interface FeedbackMessage {
  id: string;
  uid: string;
  text: string;
  ctx: string;
  ts: number;
  status?: 'open' | 'replied' | 'archived';
  reply?: string;
  replyTs?: number;
  repliedBy?: string;
}

type FeedbackDoc = Omit<FeedbackMessage, 'id'> & { ts?: Timestamp | number; replyTs?: Timestamp | number };

function millis(v: Timestamp | number | undefined): number {
  if (!v) return 0;
  return typeof v === 'number' ? v : v.toMillis();
}

export function isAllowedAdminEmail(user: User | null): boolean {
  return isAdminEmail(user?.email);
}

export function watchAdminAuth(cb: (user: User | null, allowed: boolean) => void): () => void {
  return onAuthStateChanged(auth, (user) => cb(user, isAllowedAdminEmail(user)));
}

export async function signInAdmin(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export function signOutAdmin(): Promise<void> {
  return signOut(auth);
}

export function watchFeedback(cb: (rows: FeedbackMessage[]) => void, onErr: () => void): () => void {
  const q = query(collection(db, 'feedback'), orderBy('ts', 'desc'), limit(200));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data() as FeedbackDoc;
      return {
        id: d.id,
        uid: data.uid ?? '',
        text: data.text ?? '',
        ctx: data.ctx ?? '',
        ts: millis(data.ts),
        status: data.status ?? 'open',
        reply: data.reply ?? '',
        replyTs: millis(data.replyTs),
        repliedBy: data.repliedBy ?? '',
      };
    }));
  }, onErr);
}

export async function replyToFeedback(id: string, reply: string, user: User): Promise<void> {
  await updateDoc(doc(db, 'feedback', id), {
    reply: reply.slice(0, 2000),
    replyTs: Date.now(),
    repliedBy: user.email ?? user.uid,
    status: 'replied',
  });
}

export async function setFeedbackStatus(id: string, status: 'open' | 'archived'): Promise<void> {
  await updateDoc(doc(db, 'feedback', id), { status });
}
