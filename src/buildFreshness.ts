// Stale-bundle detection for installed/PWA users. The service worker serves a
// cached shell, so a player who installed weeks ago can linger on an old
// bundle indefinitely. Each production build bakes __BUILD_TAG__ into the JS
// and emits the same tag at /build-tag.json; comparing the two over the
// network (no-store) on focus/visibility tells us a newer deploy exists.
// Navigations are network-first in sw.js, so a plain reload picks it up.

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function currentBuildTag(): string {
  return typeof __BUILD_TAG__ === 'string' ? __BUILD_TAG__ : 'dev';
}

/** Pure compare, exported for tests. Unknown/missing tags are never stale. */
export function isStaleBuild(current: string, fetched: unknown): boolean {
  if (current === 'dev') return false; // vite dev server has no build tag
  const tag = (fetched as { tag?: unknown } | null)?.tag;
  return typeof tag === 'string' && tag.length > 0 && tag !== current;
}

/**
 * Watch for newer deploys; invokes onStale once when detected.
 * Returns an unsubscribe function.
 */
export function watchBuildFreshness(onStale: () => void): () => void {
  let stopped = false;
  let notified = false;
  const check = async () => {
    if (stopped || notified || document.hidden) return;
    try {
      const res = await fetch('/build-tag.json', { cache: 'no-store' });
      if (!res.ok) return;
      if (isStaleBuild(currentBuildTag(), await res.json())) {
        notified = true;
        onStale();
      }
    } catch {
      // offline / blocked — try again on the next trigger
    }
  };
  const onVisible = () => { if (!document.hidden) void check(); };
  const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  window.addEventListener('focus', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  void check();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
