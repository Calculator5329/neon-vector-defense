// Hidden admin access. Not a security boundary — the bundle ships to clients, so
// treat the dashboard as read-only and assume a determined user can reach it. The
// token just keeps it out of sight for ordinary players. Real protection lives in
// firestore.rules (telemetry is read-only, no PII, no writeable surface here).

const TOKEN = 'lantern-seven';
const FLAG = 'nvd-admin';

/** True if the current session should see the admin dashboard.
 *  Unlocks via `?admin=lantern-seven` (then sticky via localStorage), or `?admin=off` to clear. */
export function isAdmin(): boolean {
  if (typeof location === 'undefined') return false;
  const param = new URLSearchParams(location.search).get('admin');
  if (param === 'off') {
    try { localStorage.removeItem(FLAG); } catch { /* ignore */ }
    return false;
  }
  if (param === TOKEN) {
    try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
    return true;
  }
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}

export function clearAdmin(): void {
  try { localStorage.removeItem(FLAG); } catch { /* ignore */ }
}
