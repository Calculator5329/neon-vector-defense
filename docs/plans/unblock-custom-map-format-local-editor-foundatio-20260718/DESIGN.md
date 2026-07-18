# Custom-map format + local editor (foundation for UGC)

**Roadmap item** (`docs/roadmap.md` → Maps & content):
> **Custom-map format + local editor (foundation for UGC).** Schema-validated
> JSON (same shape as `MAPS[]` entries + version hash), a dev-mode editor screen
> for path/blocker painting, local-only play. Sharing/upload is a LATER step
> gated on moderation + replay-integrity design (map hash must join the replay
> manifest before any shared-map leaderboard exists).

**Ethan's decision:** APPROVED.

**Status:** design complete. Source implementation is dispatched as a follow-up
task — see [`DISPATCH.md`](./DISPATCH.md). This lane owns only the plan folder;
it writes no source.

---

## 1. What this is and is not

**Verb served:** let a developer (dev-mode only) *author a playable map by hand*
and *play it locally against the real engine*, using the exact same `GameMap`
shape the built-in sectors use.

**In scope (v1 foundation):**
1. A **custom-map file format** — a versioned JSON envelope wrapping the
   sim-relevant `GameMap` fields plus a geometry hash, byte-identical to the
   replay hash so a future shared-map path can reuse it verbatim.
2. A **pure validator** (`validateCustomMap`) enforcing every invariant the
   engine and the existing `maps.test.ts` already assume, returning typed
   errors — no throwing, no engine coupling.
3. A **dev-mode editor screen** (canvas painting of path waypoints + blocker
   discs) that imports/exports the format and reuses existing render helpers.
4. **Local-only play**: load a validated custom map into `GameScreen`/engine as
   an ordinary `GameMap`; runs are flagged local and **never** upload telemetry,
   touch a leaderboard, or count toward campaign progress.

**Explicitly out of scope (LATER, gated — do NOT build here):**
- Any upload, share link, cloud persistence, or moderation.
- Any custom-map leaderboard or replay verification of custom maps.
- Joining the custom-map hash to the replay manifest / `resolveReplayMap`
  registry. This is the exact integrity precondition the roadmap names; it is a
  separate design once a sharing surface exists.
- Custom **waves / difficulty / enemy** authoring — v1 reuses the built-in
  `DIFFICULTIES` and standard wave generation. Only *geometry* is authored.

This ordering is deliberate: everything in scope is a local, offline,
dev-gated tool with zero server surface, so it carries no moderation or
integrity risk. The moment a map can reach another player, the replay-manifest
work in §7 becomes a hard gate.

---

## 2. Why the format mirrors `GameMap` + the replay hash

The engine already consumes `GameMap` (`src/game/types.ts:300`) and decides
placement legality purely from `path`, `pathWidth`, and `blockers`
(`engine.ts:792 placementBlockReason`). Rendering consumes `theme` and the same
geometry (`render.ts buildBackground/drawBlockers/drawMarkers`). So a custom map
that satisfies `GameMap` needs **zero engine changes** to be playable.

The replay layer hashes only the **sim-affecting** subset — `id`, `path`,
`blockers`, `pathWidth` — via `hashReplayMapGeometry` (`mapVersions.ts:34`,
FNV-1a → 8-char lowercase hex, matching the Firestore `^[a-f0-9]{8}$` bound).
`zones` is sim-relevant but currently unhashed; `theme/name/desc/music` are
cosmetic and never hashed. The custom-map envelope stores that **same** hash so
that when sharing is designed later, the custom-map hash is already the value a
replay manifest would carry — no reformatting, no second hash function.

**Reuse, do not fork:** the validator and format MUST call the existing
`hashReplayMapGeometry` from `mapVersions.ts`. Do not copy the FNV loop.

---

## 3. The file format

A single JSON object. Extension convention: `.nvdmap.json`. MIME on download:
`application/json`.

```jsonc
{
  "format": "nvd-custom-map",   // literal discriminator
  "formatVersion": 1,           // integer; bump only on breaking shape change
  "hash": "1a2b3c4d",           // hashReplayMapGeometry(map) — 8-char lowercase hex
  "map": {
    "id": "custom-abcd12",      // "custom-" + 6 lowercase base36 chars
    "name": "My Test Lane",     // 1..40 chars after trim
    "desc": "A hand-built corridor.", // 0..160 chars
    "difficulty": "Medium",     // "Easy" | "Medium" | "Hard" (label only)
    "pathWidth": 44,            // integer 30..80
    "path": [                   // >= 2 waypoints, first+last off-screen (spawn/exit)
      { "x": -40, "y": 250 },
      { "x": 640, "y": 250 },
      { "x": 1320, "y": 250 }
    ],
    "blockers": [               // 0..40 discs; r===0 allowed as a point marker
      { "x": 400, "y": 400, "r": 40 }
    ],
    "zones": []                 // optional; same shape as blockers (Blackout Reach)
  }
}
```

Notes:
- `map` is a strict `GameMap` **minus `theme`**. `theme` is **not** stored in
  the file (it is cosmetic, unhashed, and pack-driven). On load, the loader
  synthesizes `theme: standardMapTheme(map.id)` so a custom map renders with the
  standard palette. This keeps the file portable and small and avoids baking a
  theme a future recipient may not own.
- `music` is omitted in v1 (defaults to map id inside the engine already).
- `hash` is **advisory/integrity** in v1 — the validator recomputes it and
  rejects a mismatch (guards against hand-edited or truncated files). It is the
  seed value for §7.
- All coordinates are in the fixed **1280×720** logical space (`W`/`H`), same as
  built-in maps.

### 3.1 Custom-map ids never collide with built-ins

Built-in ids are short words (`orbital`, `foundry`, …). Custom ids are forced to
the `custom-<6 base36>` shape and the validator rejects any `map.id` that
`ALL_MAPS` already contains. This guarantees a custom map can never masquerade
as a built-in sector — important because `resolveReplayMap` keys off `id`, so a
future shared map with a colliding id would otherwise be indistinguishable from
a built-in in a replay.

---

## 4. TypeScript surface

New file `src/game/customMap.ts` (pure, no React, no DOM, no engine import):

```ts
import type { GameMap, Vec } from './types';
import { ALL_MAPS } from './maps';
import { hashReplayMapGeometry } from './mapVersions';
import { standardMapTheme } from './mapThemes';

export const CUSTOM_MAP_FORMAT = 'nvd-custom-map';
export const CUSTOM_MAP_FORMAT_VERSION = 1;

/** GameMap minus the cosmetic `theme` (synthesized on load). */
export type CustomMapGeometry = Omit<GameMap, 'theme' | 'music'>;

export interface CustomMapFile {
  format: typeof CUSTOM_MAP_FORMAT;
  formatVersion: number;
  hash: string;
  map: CustomMapGeometry;
}

export interface ValidationError { field: string; message: string; }

export type ValidateResult =
  | { ok: true; file: CustomMapFile; map: GameMap }  // map = engine-ready (theme added)
  | { ok: false; errors: ValidationError[] };

/** Parse+validate an unknown value (already JSON.parsed). Never throws. */
export function validateCustomMap(input: unknown): ValidateResult;

/** Build a CustomMapFile from an in-editor geometry (computes hash). */
export function serializeCustomMap(geom: CustomMapGeometry): CustomMapFile;

/** Fresh blank map for the editor: id, a 3-point straight lane, no blockers. */
export function blankCustomMap(newId: string): CustomMapGeometry;

/** Deterministic id from a seed integer (editor passes an incrementing counter;
 *  no Math.random so the same session is reproducible in tests). */
export function makeCustomMapId(seed: number): string;
```

The `.map` returned on success is the full `GameMap` (theme added) ready to hand
straight to `GameScreen`.

---

## 5. Validation invariants (authoritative list)

`validateCustomMap` collects **all** failures (not first-fail) so the editor can
show every problem at once. Invariants mirror `engine.placementBlockReason` and
the existing `tests/unit/maps.test.ts` so a custom map behaves exactly like a
built-in:

Structural / type:
1. Top-level `format === 'nvd-custom-map'` and `formatVersion === 1`.
2. `map` is an object; every field present with the right primitive/array type.
3. `id` matches `/^custom-[a-z0-9]{6}$/` and is **not** in `ALL_MAPS`.
4. `name` trims to 1..40 chars; `desc` ≤ 160 chars; `difficulty ∈ {Easy,Medium,Hard}`.
5. `pathWidth` integer in `[30, 80]`.
6. `path` array length ≥ 2; each point `{x,y}` finite numbers.
7. `blockers` length ≤ 40; each `{x,y,r}` finite, `r ≥ 0`, `r ≤ 200`.
8. `zones` (if present) same shape/limits as blockers.

Geometry (match `maps.test.ts`):
9. First and last waypoint are **off-screen** (`x<0||x>W||y<0||y>H`) — spawn+exit.
10. Every **interior** waypoint is in-bounds with pathWidth margin
    (`pathWidth/2 ≤ x ≤ W-pathWidth/2`, same for y).
11. Every segment length ≥ `MIN_SEGMENT` (80px) — no degenerate hops.
12. Every blocker with `r>0` clears the lane: `minPathDistance(b) - b.r -
    pathWidth/2 ≥ 4`. (Reuse the `distToSeg` already exported/used in engine;
    the test file has a local copy — extract a shared `distToSeg` helper OR
    replicate the exact formula. Prefer extracting to avoid drift.)

Integrity:
13. `hash === hashReplayMapGeometry(map)` (recompute; reject mismatch).

Playability (cheap reachability guard so an unplayable map can't be saved):
14. `path` produces a non-zero `pathLength`; there exists **at least one** legal
    build cell — sample a coarse grid (e.g. 32px) and require ≥ 1 point where a
    tower could be placed (same clearance math as `placementBlockReason`,
    ignoring the tower-vs-tower check). Prevents a map with no buildable space.

Each violation → one `ValidationError` with a human field label the editor
surfaces inline.

---

## 6. Editor screen (dev-mode gated)

### 6.1 Gating

Reuse the existing query-param convention in `src/appShared.ts` (which already
derives `PERF_MAP`, `DEMO_MODE` from `location.search`). Add:

```ts
export const MAP_EDITOR_ENABLED =
  import.meta.env.DEV || PERF_PARAMS.get('editor') === '1';
```

Gate on **either** a dev build **or** `?editor=1`, so it works from a local dev
server and from a preview build without shipping a visible button to players.
The editor entry (a small "MAP LAB" affordance) renders in `MainMenu` only when
`MAP_EDITOR_ENABLED`. In a normal production build with no query param it is
completely absent. **No new production UI for end users.**

### 6.2 Screen wiring

Extend the `Screen` union in `App.tsx` (`type Screen = 'menu' | 'game'`) to
`'menu' | 'game' | 'editor'`. Add a `MapEditor` component under
`src/game-ui/MapEditor.tsx`. App holds an optional `customMap: GameMap | null`
state; "Play" from the editor sets `customMap`, sets `runMode='custom'`, and
switches to `screen='game'` with `map={customMap}`.

### 6.3 Interaction model (canvas)

A single `<canvas>` at 1280×720 logical (scaled to fit), reusing render helpers
where practical (`buildBackground`, `drawBlockers`, `drawMarkers`) so the editor
preview looks like the game.

- **Path mode:** click to append a waypoint; drag an existing node to move it;
  click a node to select, `Delete` removes it. First/last nodes are visually
  tagged SPAWN / EXIT and snap off-screen when dragged near an edge.
- **Blocker mode:** click to drop a disc; drag center to move; drag rim to
  resize `r`; `Delete` removes selected.
- **Live validation:** re-run `validateCustomMap` on every edit (it's pure and
  cheap); overlay the lane clearance in red where a blocker/segment violates,
  and show the error list in a side panel. **Play** and **Export** are disabled
  until `ok:true`.
- **Fields:** name, desc, difficulty label, pathWidth slider (30–80).

### 6.4 Import / export / local persistence

- **Export:** `serializeCustomMap` → `JSON.stringify` → `Blob` download named
  `<id>.nvdmap.json`.
- **Import:** file `<input>` → `JSON.parse` → `validateCustomMap`; on failure
  show the error list, do not load.
- **Local drafts:** persist the in-progress map list to `localStorage` under a
  new namespaced key `nvd-custom-maps-v1` (follow the `storage.ts` pattern:
  namespaced key, try/catch, tolerate absent `localStorage`). Drafts are a
  convenience only; the file is the portable artifact. Cap stored drafts (e.g.
  20) to bound storage.

### 6.5 Play path — local-only, no telemetry

`GameScreen`/`engine` already take a `GameMap`; a custom map flows in unchanged.
The one hard requirement: a custom run must **never** upload telemetry, write a
leaderboard token, or count toward campaign/meta progress.

Implementation: thread a `local?: boolean` (or `runMode==='custom'`) flag from
App → `GameScreen` → the telemetry recorder / submit path. Where the existing
code decides to persist/submit a run, add `if (isLocalCustomRun) return;` **at
the earliest submit boundary** (the recorder's finalize/submit entry, not deep
in the network layer). Custom runs still play, show HUD, and reach victory/
defeat locally — they just produce no durable artifact. This must be covered by
a test (see §8, test 5) because it is the integrity-relevant guarantee of v1.

Because `resolveReplayMap` only knows `ALL_MAPS`, a custom run is intrinsically
unverifiable anyway; the flag makes that explicit and prevents an
unverifiable-but-uploaded doc from ever being written.

---

## 7. The LATER gate (documented, not built)

Before any custom map can be shared or leaderboarded, this sequence is required
(this section is the "replay-integrity design" the roadmap points at — capture
it so the follow-up sharing task starts from it):

1. **Manifest carriage:** `resolveReplayMap(mapId, mapHash)` must resolve a
   shared map's geometry from its carried hash, not from `ALL_MAPS`. Options:
   embed the full custom geometry in the run doc's `setup`, or resolve from a
   moderated custom-map store keyed by hash. Either way the run's
   `setup.mapHash` must equal `hashReplayMapGeometry(customGeom)` — already true
   by construction because §3 stores that exact hash.
2. **Hash coverage of `zones`:** `zones` is sim-relevant but unhashed today.
   Sharing a map with zones requires folding `zones` into the hash (a
   coordinated, versioned change to `hashReplayMapGeometry` + the Firestore
   rules) OR forbidding zones in shared custom maps. Decide there.
3. **Moderation:** name/desc are free text and geometry can encode imagery;
   sharing needs a moderation surface. Out of scope until a share button exists.
4. **Balance-CI stance:** shared maps do not go through the balance-CI gate that
   built-in sectors do; a shared-map leaderboard needs its own abuse/degenerate-
   map policy.

None of this is implemented in v1. v1's only obligation to the future is: the
stored hash is the manifest hash (satisfied), and custom ids can't collide with
built-ins (satisfied).

---

## 8. Test plan (all under `tests/unit/`, `npm test`)

New file `tests/unit/custom-map.test.ts`:

1. **Round-trip:** `serializeCustomMap(blankCustomMap(id))` →
   `validateCustomMap` returns `ok:true` and `map.theme` is populated; the
   re-serialized file is byte-identical.
2. **Hash reuse:** the file `hash` equals `hashReplayMapGeometry(map)` and
   equals what the replay layer would compute for the same geometry (import both
   and assert equality — guards against a forked hash).
3. **Each invariant rejects:** a table of malformed inputs (bad `format`,
   colliding built-in id, off-screen interior point, on-screen spawn, short
   segment, blocker intruding the lane, hash mismatch, no buildable cell) each
   yields `ok:false` with the expected `field`. Assert `errors` collects
   **multiple** failures at once for a doubly-broken map.
4. **Built-in parity:** for each `ALL_MAPS` entry, converting it to a
   `CustomMapGeometry` (drop theme, add `custom-` id) and validating passes —
   proves the invariant set is not stricter than shipped maps (except the id
   rule). This ties the validator to reality and will catch drift if a built-in
   map ever violates a rule the validator invented.
5. **Local-run isolation:** a custom run does not enqueue/submit telemetry.
   Drive the recorder/submit boundary with `runMode='custom'` (or `local:true`)
   and assert no submit/token/leaderboard write occurs, while a normal run in
   the same harness does. This is the integrity-critical test.

The editor UI itself is exercised by the existing Playwright/e2e layer if
present; unit coverage targets the pure format + the isolation flag, which are
the parts that carry correctness/integrity weight.

---

## 9. File-touch summary for the follow-up task

| File | Change |
|------|--------|
| `src/game/customMap.ts` | **new** — format types, `validateCustomMap`, `serializeCustomMap`, `blankCustomMap`, `makeCustomMapId`. |
| `src/game/mapVersions.ts` | (maybe) export `distToSeg` if extracted for shared use — otherwise untouched. |
| `src/appShared.ts` | add `MAP_EDITOR_ENABLED`. |
| `src/App.tsx` | extend `Screen` union with `'editor'`; `customMap` state; wire editor→game; pass `local`/`runMode='custom'`. |
| `src/menu/MainMenu.tsx` | dev-gated "MAP LAB" entry (only when `MAP_EDITOR_ENABLED`). |
| `src/game-ui/MapEditor.tsx` | **new** — canvas editor, import/export, live validation, local drafts. |
| `src/game-ui/GameScreen.tsx` | accept/propagate the local-run flag to suppress telemetry submit. |
| `src/game/runTelemetry.ts` (or the submit boundary) | early-return / skip submit when the run is a local custom run. |
| `tests/unit/custom-map.test.ts` | **new** — §8 tests. |
| `docs/changelog.md` | entry. |
| `docs/roadmap.md` | tick the item (done by harvesting session, not the impl task). |

## 10. Acceptance criteria

- [ ] `.nvdmap.json` format defined; `validateCustomMap` enforces §5 invariants
      and reuses `hashReplayMapGeometry`.
- [ ] Editor screen reachable only under `import.meta.env.DEV` or `?editor=1`;
      absent from a plain production build.
- [ ] Path + blocker painting with live validation; Play/Export disabled while
      invalid.
- [ ] A validated custom map plays locally through the real engine to
      victory/defeat.
- [ ] A custom run uploads **no** telemetry / leaderboard / progress (test 5).
- [ ] No custom-map sharing, upload, moderation, or leaderboard surface exists.
- [ ] `npm test` green, including `tests/unit/custom-map.test.ts`.
