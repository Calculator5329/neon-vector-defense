import { deleteDoc, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebaseClient';
import {
  sanitizeWeeklyGauntletDoc,
  sanitizeWeeklyOverrideDoc,
  type WeeklyGauntletDoc,
  type WeeklyOverrideDoc,
} from './weeklyChallenge';

const db = getFirestore(app);
const functions = getFunctions(app, 'us-central1');

const weeklyOverrideRef = () => doc(db, 'config', 'weeklyOverride');
const weeklyGauntletRef = () => doc(db, 'config', 'weeklyGauntlet');

const callCrownWeeklyGauntlet = httpsCallable<{ week?: string }, { published: boolean; reason?: string; gauntlet?: WeeklyGauntletDoc }>(
  functions,
  'crownWeeklyGauntlet',
);

export async function fetchWeeklyOverrideAdmin(): Promise<WeeklyOverrideDoc | null> {
  const snap = await getDoc(weeklyOverrideRef());
  return snap.exists() ? sanitizeWeeklyOverrideDoc(snap.data()) : null;
}

export async function publishWeeklyOverrideAdmin(override: WeeklyOverrideDoc): Promise<void> {
  await setDoc(weeklyOverrideRef(), override);
}

export async function clearWeeklyOverrideAdmin(): Promise<void> {
  await deleteDoc(weeklyOverrideRef());
}

export async function fetchWeeklyGauntletAdmin(): Promise<WeeklyGauntletDoc | null> {
  const snap = await getDoc(weeklyGauntletRef());
  return snap.exists() ? sanitizeWeeklyGauntletDoc(snap.data()) : null;
}

export async function publishWeeklyGauntletAdmin(gauntlet: WeeklyGauntletDoc): Promise<void> {
  await setDoc(weeklyGauntletRef(), gauntlet);
}

export async function crownWeeklyGauntletAdmin(week?: string): Promise<WeeklyGauntletDoc | null> {
  const result = await callCrownWeeklyGauntlet(week ? { week } : {});
  return result.data.gauntlet ? sanitizeWeeklyGauntletDoc(result.data.gauntlet) : null;
}
