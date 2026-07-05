import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'functions/src/generated/reSimulate.js');
const dtsFile = resolve(root, 'functions/src/generated/reSimulate.d.ts');

async function firstExisting(path) {
  const candidates = extname(path) ? [path] : [path, `${path}.ts`, `${path}.tsx`, `${path}.js`];
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // try the next extension
    }
  }
  return null;
}

const repoFsPlugin = {
  name: 'repo-fs',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, async (args) => {
      if (args.path === './firestoreLazy' || args.path.endsWith('/firestoreLazy')) {
        return { path: 'firestoreLazy', namespace: 'stub' };
      }
      const resolved = await firstExisting(resolve(args.resolveDir, args.path));
      if (!resolved) return null;
      return { path: resolved, namespace: 'repo' };
    });
    build.onLoad({ filter: /^firestoreLazy$/, namespace: 'stub' }, () => ({
      contents: 'export async function firestore() { throw new Error("Firestore is unavailable in the reSim bundle"); }',
      loader: 'js',
    }));
    build.onLoad({ filter: /.*/, namespace: 'repo' }, async (args) => {
      const extension = extname(args.path);
      return {
        contents: await readFile(args.path, 'utf8'),
        loader: extension === '.tsx' ? 'tsx' : extension === '.js' ? 'js' : 'ts',
        resolveDir: dirname(args.path),
      };
    });
  },
};

process.chdir(root);
await mkdir(dirname(outfile), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  stdin: {
    contents: await readFile(resolve(root, 'src/game/reSimulate.ts'), 'utf8'),
    loader: 'ts',
    resolveDir: resolve(root, 'src/game'),
    sourcefile: 'src/game/reSimulate.ts',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  plugins: [repoFsPlugin],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

await writeFile(dtsFile, `export type ReSimVerdict = 'verified' | 'divergent' | 'unverifiable';

export interface ReSimDivergence {
  field: string;
  expected: unknown;
  actual: unknown;
  at?: { eventIndex?: number; t?: number; wave?: number; type?: string };
}

export interface ReSimResult {
  verdict: ReSimVerdict;
  reason?: string;
  divergence?: ReSimDivergence;
  summary?: unknown;
}

export interface ReSimBundle {
  run: Record<string, unknown>;
  chunks: Array<Record<string, unknown>>;
}

export function reSimulate(bundle: ReSimBundle): ReSimResult;
export function reSimulateUploadBundle(bundle: ReSimBundle): ReSimResult;
export function setBalanceDoc(raw: unknown): void;
export function setDailyOverrideDoc(raw: unknown): void;
export function setWeeklyOverrideDoc(raw: unknown): void;
export function dailyChallengeForId(id: string): unknown;
export function weeklyChallengeForId(id: string): unknown;
`);
