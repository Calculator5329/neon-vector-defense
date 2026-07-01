# Neon Vector Defense — Business Plan & Execution Order (v3)

*Consolidates the v1 business plan and v2 web-launch plan, reconciled against the actual
codebase as of 2026-07-01. Strategy is unchanged; the "what's missing" lists are updated,
because much of what v2 flagged has since shipped — and a full-project review found the
successor gaps.*

Live: https://neon-vector-defense-7.web.app

---

## 1. Strategy (unchanged)

Web-first roguelite tower defense. Launch on browser game portals (CrazyGames, Poki, itch.io,
Newgrounds), get traction and revenue at the highest-margin channel (web checkout, no
app-store tax), then carry proven retention into mobile.

The moat is **sim-in-the-loop velocity**: an owned headless engine + bot harness + balance
simulator that closes the observe→tune→ship loop in days. The product is not "a game that
collects data" — it is "a game that out-iterates everyone in its niche because it can
simulate its own balance."

Two user tiers remain the compliance architecture:

- **Adult tier** — full consent-gated first-party gameplay telemetry, full monetization.
- **Kids/unknown tier** — fail-safe defaults: minimal data, no persistent PII, no targeted
  monetization. COPPA addressed by tiering, not geo-blocking.

**Launch market: US-first.** GDPR/EU consent UX, mobile age-signal APIs, and parental-consent
flows stay deferred until mobile/international expansion.

---

## 2. Current state vs. the v2 plan (2026-07-01 reconciliation)

| v2 item | Status in code today |
| --- | --- |
| 1C leaderboard integrity ("client-submitted, spoofable") | **Shipped.** Scores accepted only via `submitScore`/`submitDailyScore` Cloud Functions with replay-token-hash verification, canonicalized values, server-time ordering. Direct board writes denied in rules. |
| 1A consent / age gate / privacy policy / deletion | **Shipped.** Neutral age gate, consent gating before telemetry writes, `/privacy` view with local export/delete, operator-run `deleteMyData` callable. CCPA GPC-honor signal still unverified. |
| 1B write-cost redesign (sampling, batching, TTL) | **Partially shipped.** 10% analytics sampling (`writePolicy.ts`), batched checkpoint flushes, atomic batched replay upload, 30s leaderboard read cache. **Not done:** TTL policies (client docs store `ts` as numbers — Firestore TTL needs Timestamp fields, so raw chunks never expire), BigQuery aggregate export, read-side aggregation. |
| Phase 2 QA scaffold | **Partially shipped.** 1,031-line Playwright e2e suite (desktop+mobile), security/rules/worker suites, engine unit tests, CI gate. **Gap:** e2e runs against the dev server — the production build and service worker are never tested; no visual-diff snapshots. |
| Phase 3 monetization | **Not started.** No checkout, entitlements, SKUs, or ads anywhere in the codebase. |
| Phase 4 portal launch | **Blocked** on: no landscape-phone layout (hard portal-cert blocker), passive modal onboarding, 101 MB `public/` asset weight. |

**New blockers the v2 plan didn't know about** (from the 2026-07-01 full review):

1. **Player writes are unauthenticated.** The player uid is a locally generated string, not
   Firebase Anonymous Auth; `firestore.rules` never checks `request.auth` on player paths.
   Any REST client with the public config can flood `runs` with ~1 MB docs — Spark's 20k
   writes/day die in minutes, and the uid-keyed rate limiter amplifies rather than stops it.
2. **Grief-deletion vector:** `replayOwners/{uid}/runs/{runId}` entries are forgeable, and
   the operator-run deletion callable trusts that index — deletions can be weaponized
   against other players' replays.
3. **Read quota is the sleeper cost:** the global-top leaderboard fans out 40 queries
   (up to ~400 reads) per menu view; a few hundred visitors/day exhausts the 50k read quota.
4. **Replay re-simulation (the anti-cheat endgame) is currently impossible:** gameplay uses
   unseeded `Math.random`, the timestep has a variable remainder substep, and sim behavior
   reads live localStorage.

---

## 3. Execution order (decided 2026-07-01)

```
TIER 0  Security & integrity blockers      ← before any promotion or traffic
TIER 2  Engine correctness + determinism   ← the 4 confirmed bugs + seeded RNG/fixed step
TIER 3  Mechanical refactors               ← App.tsx / engine / CSS splits (no behavior change)
TIER 4  CI & tooling wins                  ← perf gate, prod-build e2e, lazy Firestore
TIER 1  Portal readiness                   ← landscape layout, onboarding, asset diet, PWA
THEN    Monetization MVP → portal submissions → growth loop
```

### Tier 0 — Security & integrity (blocking; ~1–2 days)
- Firebase Anonymous Auth + `request.auth != null` on every player create rule; bind
  `uid == request.auth.uid` on `replayOwners`/`runAnalytics`/`runCheckpoints`/`telemetry`.
- Fix `deleteRunArtifacts` to corroborate ownership before deleting run docs.
- Enforce App Check (already plumbed; flip `ENFORCE_APP_CHECK` + console enforcement).
- Worker AI proxy: key the KV daily quota by IP only (drop the UA dimension).
- Single-source the admin allowlist; remove the comma-typo email present in both copies.
- Fix TTL: store expiry fields as Firestore Timestamps so raw chunk retention actually works.

### Tier 2 — Engine correctness + determinism (~3–5 days)
- Fix: cloak-reveal projectile predicate, burn attribution/stacking, same-tick terminal
  leaks (guard `recordRunEnd`), campaign unlock enforcement in `Game.placeTower`.
- Injected seeded RNG for gameplay randomness (splitter spawns, pickup drops; bot decisions
  optional); record the seed in `RunRecorder`.
- True fixed-timestep accumulator (exact quanta, carried remainder); per-Game uid counter.
- Decouple `towerAvailable` from live localStorage so sims/replays don't depend on the host save.

### Tiers 3–4 — Mechanical refactors + CI (incremental)
- App.tsx split along existing seams (`menu/`, `game/`, `widgets/`, `overlays/`); extract
  `useGameLoop` / `useRunTelemetry` so business logic leaves the rAF callback.
- Admin CSS out of App.css; dead-rule purge; 3-token breakpoint scale (560/760/980).
- Engine: per-FireStyle handler map + split spawning/movement/FX/freeplay-meta modules.
  (Deeper changes — event bus, `useSyncExternalStore` — deferred by decision: mechanical only.)
- CI: make `perf.ts` exit non-zero on regression; run e2e against `vite preview` of `dist/`;
  add a service-worker e2e; lazy-load Firestore off first paint; parallelize CI jobs.
- Evict `public/tower-deep-dive-report.json` (11 MB) from hosting/git.

### Tier 1 — Portal readiness (~1–2 weeks)
- Landscape-phone command layout (`(orientation: landscape) and (max-height: 500px)` tier);
  pause the game while the rotate overlay shows; drop `user-scalable=no`.
- Action-gated onboarding: 3 staged in-game prompts (place → launch → upgrade) driven by
  existing recorder events; demote HowToPlay/Briefing to optional.
- Asset diet: PNG→WebP (~61 MB→~15 MB), `briefing.wav`→mp3, self-host fonts.
- Aggregated global-top leaderboard doc maintained by the submit function (kills the fan-out).
- PWA: 192/512 maskable icons, build precache + update toast.
- Verify CCPA/GPC opt-out signal handling before portal traffic.

### Monetization MVP (after Tier 1; launch-safe minimum first)
- Stripe (or Paddle as merchant-of-record) web checkout.
- Launch SKUs: cosmetic palette/skin packs + premium one-time unlock. No pay-to-win.
- Server-side entitlements keyed to the (now real) authenticated uid.
- Later: Signal Pass seasonal track, core packs, opt-in rewarded ads (adult tier only).
- Daily seed + leaderboards stay free forever — they are the virality engine.

---

## 4. KPIs

| Area | Metric | Target / guardrail |
| --- | --- | --- |
| Retention | D1 / D7 return rate | D1 ≥ 25%, D7 ≥ 8% (portal-typical good) |
| Engagement | Runs per session; median session length | ≥ 2 runs; ≥ 8 min |
| Onboarding | First-session run completion; tutorial abandonment | Mine `runAnalytics.onboarding` before/after the action-gated tutorial |
| Virality | `?run=` replay opens per 100 runs; dossier shares | Watch `replayOpens` + share counters |
| Revenue | Conversion to first purchase; ARPDAU | ≥ 1% conversion is healthy for web |
| Cost | Firestore writes/run, reads/menu-view | ≤ 7 writes/run; ≤ 5 reads/menu-view after aggregation |
| Quality | CI perf gate (avg update ≤ 8 ms); zero known launch-checklist bugs | Hard gates |

---

## 5. Cost model & quota guardrails

- Legit scored run ≈ 5–7 Firestore writes (+5–15 when in the 10% analytics sample).
  Spark supports roughly 2–3k scored runs/day — fine organically **only after Tier 0
  closes the unauthenticated flood path.**
- Reads are the bigger organic risk: fix the 40-query global-top fan-out before portals.
- TTL raw `runCheckpoints`/replay chunks (post Timestamp fix); keep aggregates.
- Export aggregates to BigQuery when analysis queries start hitting Firestore read pricing.
- Blaze upgrade decision point: sustained >2k runs/day or first monetization revenue —
  whichever comes first; set budget alerts the same day.

---

## 6. Launch gate checklist

- [x] Tier 0 complete (auth, deletion fix, quota keying, allowlist, TTL) — App Check enforcement still staged
- [x] Tier 2 complete (4 correctness bugs fixed; deterministic sim behind a seed)
- [x] CI gates real: perf fails on regression; e2e runs the production build + SW
- [x] Landscape-phone layout (short-landscape tier verified at 844×390)
- [x] Action-gated onboarding live — drop-off re-measure pending live traffic
- [x] `public/` ≤ ~25 MB (art 63.7→3.2 MB); first-paint JS ~204 KB gzip
- [x] Leaderboard read aggregation live
- [x] CCPA/GPC verified: opt-out + GPC force restricted tier (unit-tested invariants)
- [ ] App Check enforced in production (staged; flip after token-flow verification)
- [ ] Minimal monetization surface live (cosmetics + premium unlock)
- [ ] Screen-by-screen QA pass at both viewports (v2 Appendix A inventory)

---

## 7. Risks (updated)

| Risk | Mitigation |
| --- | --- |
| Unauthenticated write flooding kills quota/billing | Tier 0 auth + App Check — do first, before any promotion |
| Read-quota exhaustion from menu traffic | Aggregated global-top doc; keep 30s caches |
| Forged-but-consistent replays on the ladder | Accepted at launch; seeded RNG + fixed timestep (Tier 2) unblocks server re-simulation when incentives justify it |
| Portal cert rejection (mobile) | Landscape layout + touch targets + a11y already strong; verify against CrazyGames/Poki checklists before submitting |
| Firestore telemetry cost scales with success | Sampling (shipped), TTL (fix field types), BigQuery export, budget alerts |
| Solo-dev bandwidth | Strict tier ordering above; mechanical-only refactors to protect velocity |
| Pay-to-win backlash | Cosmetics/convenience only; daily seed + boards free |

---

*The expensive half — instrumentation, simulation, replay-verified boards, consent/privacy
scaffolding — is built. The remaining work is: lock the doors (Tier 0), make the sim
trustworthy (Tier 2), keep the codebase fast to change (Tiers 3–4), open the mobile front
door (Tier 1), then put a checkout in front of it.*
