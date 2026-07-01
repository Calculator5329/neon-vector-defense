export const WIDGET_OPEN_EVENT = 'nvd-widget-open-change';

// browser perf harness: /?perf=<mapId>&diff=<diffId> auto-runs the expert bot at 4x
// with rendering on and a live FPS meter. Example: /?perf=throat&diff=hard
export const PERF_PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const PERF_MAP = PERF_PARAMS.get('perf');
export const DEMO_MODE = PERF_PARAMS.get('demo') === '1';
export const AI_HELP_ENABLED = Boolean(import.meta.env.VITE_AI_HELP_URL);

const RUN_ID_RE = /^r_[A-Za-z0-9_-]{8,80}$/;
export function isRunId(id: string | null | undefined): id is string {
  return !!id && RUN_ID_RE.test(id);
}
