// Runtime URLs share the built module's directory, even on a nested SPA route.
// Vite rewrites HTML/CSS assets itself, but not strings passed to img/Audio/fetch.
const base = import.meta.env?.BASE_URL ?? '/';
const parentDirectory = '../';
const appBase = base === './' ? new URL(parentDirectory, import.meta.url).pathname : base;

export function appUrl(path = ''): string {
  return `${appBase}${path.replace(/^\/+/, '')}`;
}
