// Admin-only writes for config/dailyOverride. Imported only by the lazy admin dashboard.
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { app } from './firebaseClient';
import { sanitizeDailyOverrideDoc, type DailyOverrideDoc } from './dailyChallenge';

const db = getFirestore(app);
const ref = () => doc(db, 'config', 'dailyOverride');

export async function fetchDailyOverrideAdmin(): Promise<DailyOverrideDoc | null> {
  const snap = await getDoc(ref());
  return snap.exists() ? sanitizeDailyOverrideDoc(snap.data()) : null;
}

export async function publishDailyOverrideAdmin(override: DailyOverrideDoc): Promise<void> {
  await setDoc(ref(), override);
}

export async function clearDailyOverrideAdmin(): Promise<void> {
  await deleteDoc(ref());
}
