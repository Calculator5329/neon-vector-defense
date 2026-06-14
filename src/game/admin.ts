// Admin route detection. Real protection for writable admin surfaces lives in
// Firebase Auth + firestore.rules; this only decides which React shell to render.

export function isAdmin(): boolean {
  if (typeof location === 'undefined') return false;
  return location.pathname === '/admin';
}

export function clearAdmin(): void {
  if (typeof location !== 'undefined') location.href = '/';
}
