# UI Stability Audit

Date: 2026-07-02

Mission: remove app-wide layout shift from transient UI, async content, variable-width counters, and state-swapped controls.

Git note: this sandbox cannot write refs or create commits (`git branch ui-stability` failed with a `.git` lock permission error). The fix column therefore names the local working-tree change pending the operator commit.

## Guardrail

- `tests/e2e/ui-stability.ts` installs a `PerformanceObserver` for `layout-shift`, ignores input-adjacent entries per CLS, and adds rect probes for stable anchor elements.
- `tests/e2e/ui-stability.spec.ts` tours menu idle, leaderboard async settle, operations claim-all, palette equip, feedback send, in-run notice overlay, counters, and the adaptation chip on desktop and mobile projects.
- The guard is strict on both browser CLS entries and before/after rects, so reserved-space regressions fail even when Chrome does not emit a CLS entry.

## Findings And Fixes

| Screen / trigger | Elements displaced or at risk | Root cause class | Fix in local tree |
| --- | --- | --- | --- |
| Leaderboard rows load, failure text appears, daily/global boards settle | Menu topbar, board container, deploy bar | Unreserved async content | Reserved fixed scroll regions for `.board-global` and `.board-local`; empty states match loaded height; row number columns use tabular/min-width figures. |
| Leaderboard `WATCH` links appear in global rows | Replay column and adjacent score columns | Conditional action width | `.watch-btn` has fixed inline-flex width and the replay column keeps a reserved end slot. |
| Operations claim buttons change `CLAIM` to `CLAIMED` | Quest row bottoms and adjacent quest cards | Conditional button swap | Quest action family uses `.no-shift-action`; progress values use `.no-shift-counter`. |
| Operations `CLAIM ALL` disappears after bulk claim | Operations board header and board grid | In-flow insertion/removal | `CLAIM ALL` is always rendered; unavailable state is an invisible placeholder with the same width. |
| Operations claim status appears after rewards | Shop, status row, board header, deploy bar | Transient in-flow insertion | `.ops-status` is always rendered with reserved height; idle state is invisible and `aria-hidden`. |
| Palette `EQUIP` changes to `EQUIPPED` | Palette rows and shop column | Conditional button swap / variable text | Palette tag reserves width and uses tabular figures; focused guard asserts the row and board stay stable after equip. |
| Credits, cores, wave, kills tick in the topbar | Canvas, sidebar, topbar items | Variable-width text | Topbar stats use tabular numbers, fixed counter spans, fixed stat widths, and horizontal overflow instead of wrapping. |
| Adaptation chip flashes in every 10-wave band | Topbar, canvas, sidebar | Conditional chip insertion | Adaptation slot is always present; inactive state is invisible and active state swaps content inside the slot. |
| In-run advisory / notice appears | Topbar, canvas, sidebar, launch button | Transient message | Existing absolute notice pattern verified by the stability guard; no sibling displacement allowed. |
| Cloak toast and hostile reveal tips | Canvas and build/sidebar chrome | Transient message | Existing overlay/tip surfaces are treated as overlays; audit guard covers the same command-layout anchors used by notices. |
| Coach chip stages advance | Canvas and bottom controls | Transient message | Existing chip stays in an overlay position; no flow dependency added. |
| Checkpoint idle/busy/done/error states | In-run controls and terminal surfaces | State-swapped text | Numeric/status labels now inherit tabular rules; transient status surfaces are documented as reserved or overlay-only. |
| Score-submit idle/busy/done/error states | End screen score box and leaderboard preview | Async content / conditional button swap | `.submit-score` and `.lb-table` reserve height; submit action width is fixed. |
| Dossier rendering, copy/share/save toasts | Score screen action row | Async content / transient toast | Dossier preview reserves aspect ratio; action buttons use `.no-shift-action`; toast is absolutely positioned inside reserved action space. |
| Feedback send, retry, receipt view | Feedback panel, toggle, deploy bar | Conditional button swap / unreserved status | Feedback panel reserves height; error slot is always present; send/check buttons use fixed widths; thanks view reserves body height. |
| Update toast | App chrome | Transient message | Existing toast layer remains fixed/overlay; no audited in-flow insertion found. |
| Unlock modal appears | Menu/game chrome | Modal insertion | Existing modal overlay does not participate in page flow; no sibling displacement accepted. |
| Relic and risk offers appear in build/freeplay | Canvas, build panel, side controls | Expanding section | Freeplay build panel is positioned as an overlay on mobile and scrolls internally; offer grids stay inside the panel instead of resizing the canvas. |
| Freeplay panel opens/closes | Canvas and mobile controls | Expanding section | Mobile freeplay panel moved out of normal flow with bounded height and internal scroll. |
| Daily rollover countdown and daily card stats tick | Menu cards and deploy bar | Variable-width text | Daily footers and hero/rail stats inherit tabular numeric rules. |
| Hostile reveal / bestiary labels | Menu/archive surfaces | Variable-width text / transient reveal | Audited as non-displacing; numeric/high-churn labels inherit tabular rules where applicable. |
| Boss bar and Umbra phase pips | React HUD | Potential overlay collision | Boss bar is rendered inside the canvas post-effects pass, so it cannot reflow React layout. |
| Replay loading and replay HUD stats | Replay canvas and stamp/stat row | Async content / variable-width text | Replay status remains overlay-like; replay stamps and stat numbers use tabular figures. |
| Admin balance publish/reset, daily override, replay spotlight status | Admin cards, tables, live-ops forms | Transient in-flow insertion | Admin status rows are always rendered with hidden idle placeholders. |
| Admin telemetry tables and filters load/update | Admin table columns and filter bar | Variable-width text / async tables | Admin numeric/table/filter classes share tabular figures; compact admin actions reserve minimum widths. |

## Acceptable Motion

- User-driven navigation, scrolling, tab changes, and modal open/close are not treated as CLS regressions when caused by direct input.
- Canvas-only effects, boss bars, particles, and phase flashes can animate visually because they do not alter DOM layout.
- Horizontal scrolling in constrained topbars/menus is acceptable when the alternative would wrap and resize the canvas or command layout.

## Verification

- `npm.cmd run typecheck:all`
- `npm.cmd run test:engine`
- `npm.cmd run test:jest`
- `npm.cmd test`
- `npm.cmd run test:e2e:prod`
- `npm.cmd run test:rules` with Java 21 and workspace-local `XDG_CONFIG_HOME`
- `npm.cmd run test:functions` with workspace-local `npm_config_cache`
- `npm.cmd run test:callables` with workspace-local `XDG_CONFIG_HOME` and `npm_config_cache`
- `npm.cmd run test:worker`
- `npm.cmd run perf:quick`
- `npm.cmd run meta:sim`
- `npm.cmd run balance:gate`
- `npm.cmd run test:e2e -- tests/e2e/ui-stability.spec.ts --project=chromium-desktop`
- `npm.cmd run test:e2e -- tests/e2e/ui-stability.spec.ts --project=chromium-mobile`
- Regression proof: temporarily changing `.ops-status.idle` from `visibility: hidden`
  to `display: none` failed the desktop guard at `operations claim all` because
  the status rect changed from `0x0` at `(0,0)` to a full `1014x38` row. The
  reserved-slot rule was restored and the desktop guard passed again.
