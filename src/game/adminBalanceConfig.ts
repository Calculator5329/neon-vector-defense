// Admin-only writes for config/balance. Imported only by the lazy admin dashboard.
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { app } from './firebaseClient';
import type { BalanceConfigDoc } from './balanceConfig';

const db = getFirestore(app);
const ref = () => doc(db, 'config', 'balance');

export async function fetchBalanceConfigAdmin(): Promise<BalanceConfigDoc | null> {
  const snap = await getDoc(ref());
  return snap.exists() ? (snap.data() as BalanceConfigDoc) : null;
}

export async function publishBalanceConfigAdmin(config: BalanceConfigDoc): Promise<void> {
  await setDoc(ref(), config);
}

export async function resetBalanceConfigAdmin(): Promise<void> {
  await deleteDoc(ref());
}
