/** Firestore rejects `undefined` anywhere in a document tree.
 * Objects can omit those fields; arrays need stable indexes, so use null there. */
export function sanitizeFirestoreData<T>(value: T): T {
  if (value === undefined) return null as T;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFirestoreData(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = sanitizeFirestoreData(entry);
    }
    return out as T;
  }
  return value;
}

