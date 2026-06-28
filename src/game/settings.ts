// Applies persisted accessibility prefs to the DOM + renderer. Call once on boot and
// again whenever a setting changes. Body classes drive CSS (.reduced-motion disables
// animations/transitions; .colorblind remaps the damage-type palette to Okabe-Ito-safe
// colors); the renderer flag suppresses camera shake + the hurt vignette.
import { progress } from './storage';
import { setReducedMotion } from './render';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyAccessibility(): void {
  const reduceMotion = progress.reducedMotion || prefersReducedMotion();
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('reduced-motion', reduceMotion);
    document.body.classList.toggle('colorblind', progress.colorblind);
  }
  setReducedMotion(reduceMotion);
}
