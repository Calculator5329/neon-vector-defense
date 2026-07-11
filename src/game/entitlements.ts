// Cosmetic-only server entitlement cache. Never imported by simulation, score,
// replay, tower, or bot paths.
import { ensureServerUid } from './anonAuth';
import { app } from './firebaseClient';
import { firestore } from './firestoreLazy';

const CACHE_PREFIX = 'nvd-entitlements-v1:';

export interface EntitlementSnapshot {
  cosmeticIds: string[];
  salvageBalance: number;
  source: 'none' | 'local-cache' | 'server';
}

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: EntitlementSnapshot = { cosmeticIds: [], salvageBalance: 0, source: 'none' };
let loadPromise: Promise<EntitlementSnapshot> | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function safeSnapshot(raw: unknown, source: EntitlementSnapshot['source']): EntitlementSnapshot {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const ids = Array.isArray(data.cosmeticIds) ? data.cosmeticIds : [];
  return {
    cosmeticIds: [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length <= 80))].slice(0, 200),
    salvageBalance: typeof data.salvageBalance === 'number' && Number.isSafeInteger(data.salvageBalance) && data.salvageBalance >= 0
      ? data.salvageBalance
      : 0,
    source,
  };
}

function readLocal(uid: string): EntitlementSnapshot | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${uid}`);
    return raw ? safeSnapshot(JSON.parse(raw), 'local-cache') : null;
  } catch {
    return null;
  }
}

function storeLocal(uid: string, value: EntitlementSnapshot): void {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${uid}`, JSON.stringify({
      cosmeticIds: value.cosmeticIds,
      salvageBalance: value.salvageBalance,
    }));
  } catch {
    // Anonymous/private browsing may deny storage; the in-memory cache remains usable.
  }
}

function replace(value: EntitlementSnapshot): EntitlementSnapshot {
  snapshot = value;
  emit();
  return value;
}

export function entitlementSnapshot(): EntitlementSnapshot {
  return snapshot;
}

export function subscribeEntitlements(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Server state wins once fetched. Before that, cached server grants and the
 * legacy anonymous local cache remain available so offline cosmetics do not
 * disappear merely because Firebase cannot start.
 */
export function ownsEntitlement(cosmeticId: string, anonymousOfflineFallback = false): boolean {
  if (snapshot.cosmeticIds.includes(cosmeticId)) return true;
  return snapshot.source !== 'server' && anonymousOfflineFallback;
}

export function loadEntitlements(): Promise<EntitlementSnapshot> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const uid = await ensureServerUid();
    if (!uid) return snapshot;
    const local = readLocal(uid);
    if (local) replace(local);
    try {
      const { fs, db } = await firestore();
      const server = await fs.getDoc(fs.doc(db, 'entitlements', uid));
      const value = safeSnapshot(server.exists() ? server.data() : {}, 'server');
      storeLocal(uid, value);
      return replace(value);
    } catch {
      return snapshot;
    }
  })().finally(() => { loadPromise = null; });
  return loadPromise;
}

function requestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `cos_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function purchaseEntitlement(cosmeticId: string): Promise<EntitlementSnapshot> {
  const uid = await ensureServerUid();
  if (!uid) throw new Error('auth-unavailable');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const callable = httpsCallable<
    { cosmeticId: string; requestId: string },
    { granted: boolean; cosmeticIds: string[]; salvageBalance: number }
  >(getFunctions(app, 'us-central1'), 'purchaseCosmeticEntitlement');
  const response = await callable({ cosmeticId, requestId: requestId() });
  if (!response.data.granted) throw new Error('grant-rejected');
  const value = safeSnapshot(response.data, 'server');
  storeLocal(uid, value);
  return replace(value);
}
