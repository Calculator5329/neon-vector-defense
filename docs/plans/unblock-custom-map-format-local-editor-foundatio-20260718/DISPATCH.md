# Follow-up task spec — implement custom-map format + local editor

This item requires source changes outside the plan folder, so it is split into
an implementation task. Dispatch this after the design lane merges. The design
of record is [`DESIGN.md`](./DESIGN.md) in this folder — the implementer must
follow it.

---

## title

Custom-map format + local editor — implement (UGC foundation, local-only)

## goal

Implement the design in
`docs/plans/unblock-custom-map-format-local-editor-foundatio-20260718/DESIGN.md`.

Deliver, exactly per that doc:

1. **`src/game/customMap.ts`** — the `.nvdmap.json` format (`CustomMapFile`,
   `CustomMapGeometry`), a pure non-throwing `validateCustomMap(input): ValidateResult`
   enforcing every §5 invariant and **reusing** `hashReplayMapGeometry` from
   `mapVersions.ts` (do not fork the hash), plus `serializeCustomMap`,
   `blankCustomMap`, `makeCustomMapId`. No React/DOM/engine imports.
2. **`src/game-ui/MapEditor.tsx`** — a dev-mode-only canvas editor for painting
   path waypoints + blocker discs, with live validation (Play/Export disabled
   while invalid), JSON import/export (`<id>.nvdmap.json`), and local drafts in
   `localStorage` key `nvd-custom-maps-v1` (follow `storage.ts` patterns).
   Reuse render helpers (`buildBackground`/`drawBlockers`/`drawMarkers`) for the
   preview.
3. **Gating** — add `MAP_EDITOR_ENABLED = import.meta.env.DEV || PERF_PARAMS.get('editor')==='1'`
   in `src/appShared.ts`; the "MAP LAB" entry in `MainMenu` renders only when
   enabled; extend `App.tsx` `Screen` union with `'editor'` and wire
   editor → local play.
4. **Local-only play** — a custom run flows into `GameScreen`/engine as a normal
   `GameMap` (theme synthesized via `standardMapTheme`) but is flagged
   `runMode='custom'` / `local`, and produces **no** telemetry upload,
   leaderboard token, or campaign/meta progress. Suppress at the earliest submit
   boundary in the recorder (`runTelemetry.ts`), not deep in the network layer.
5. **`tests/unit/custom-map.test.ts`** — the five test groups in DESIGN §8:
   round-trip, hash-reuse equals replay-layer hash, per-invariant rejection
   (multi-error collection), built-in-map parity, and local-run telemetry
   isolation.
6. Add a `docs/changelog.md` entry (newest on top).

**Do NOT build** (LATER, gated per DESIGN §7): sharing, upload, cloud
persistence, moderation, custom-map leaderboards, replay verification of custom
maps, or joining the custom-map hash to `resolveReplayMap`. Also do not add
custom wave/enemy/difficulty authoring — geometry only; reuse built-in
`DIFFICULTIES`.

## owns

```
src/game/customMap.ts
src/game-ui/MapEditor.tsx
src/game-ui/GameScreen.tsx
src/menu/MainMenu.tsx
src/App.tsx
src/appShared.ts
src/game/runTelemetry.ts
src/game/mapVersions.ts        # only if extracting a shared distToSeg helper
tests/unit/custom-map.test.ts
docs/changelog.md
```

(The roadmap tick in `docs/roadmap.md` is handled by the harvesting session, not
this task.)

## test-cmd

```sh
npm test
```

Acceptance = DESIGN §10 checklist, all boxes green, `npm test` passing including
the new `tests/unit/custom-map.test.ts`.

## model tier

smart (multi-file UI + engine-boundary change + integrity-relevant test).

## notes for the implementer

- Placement legality reference: `engine.ts:792 placementBlockReason`
  (pathWidth/2 + TOWER_R − 4 lane clearance; blocker r + TOWER_R − 4).
- Geometry invariants already encoded in `tests/unit/maps.test.ts` — mirror them
  in the validator so custom maps behave identically to built-ins; test 4
  (built-in parity) guards against drift.
- The stored `hash` MUST equal `hashReplayMapGeometry(map)` so a future sharing
  path reuses it verbatim; custom ids MUST match `custom-<6 base36>` and not
  collide with `ALL_MAPS` ids.
- Verify the editor is invisible in a plain `vite build` preview with no
  `?editor=1` (dev-gate is real, not cosmetic).
