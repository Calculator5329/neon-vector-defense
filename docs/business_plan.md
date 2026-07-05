# Lantern 7 — Business Plan & Execution Order (v3)

*Consolidates the v1 business plan and v2 web-launch plan, reconciled against the actual
codebase as of 2026-07-03. Strategy is unchanged; current shipped status and
priorities are summarized in `docs/roadmap.md`.*

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
| 1A consent / age gate / privacy policy / deletion | **Shipped.** Neutral age gate, consent gating before telemetry writes, `/privacy` view with local export/delete, operator-run `deleteMyData` callable, and CCPA/GPC invariants covered by tests. |
| 1B write-cost redesign (sampling, batching, TTL) | **Mostly shipped.** 10% analytics sampling, batched checkpoint flushes, atomic replay upload/streaming, aggregated leaderboard reads, TTL fields, and cached reads are in place. BigQuery export remains deferred until traffic warrants it. |
| Phase 2 QA scaffold | **Shipped for launch gating.** Playwright e2e covers desktop/mobile plus production preview/SW flows in deploy workflows; security/rules/worker/functions suites, engine unit tests, Jest guardrails, perf smoke, and balance gate are wired. Visual-diff snapshots remain optional future hardening. |
| Phase 3 monetization | **Not started.** No checkout, entitlements, SKUs, or ads anywhere in the codebase. |
| Phase 4 portal launch | **Implementation-ready; ops remaining.** CrazyGames/Poki build flavors and SDK hooks are wired, short-landscape touch tier exists, onboarding is action-gated, and asset weight has been reduced. External account setup, store copy, screenshots, and approval requests remain. |

The 2026-07-01 blockers have been closed or staged: anonymous auth backs player writes, replay deletion corroborates ownership, leaderboard reads use aggregate documents, and deterministic replay re-simulation exists for admin audit. App Check enforcement remains staged until production token metrics are clean.

---

## 3. Execution order (current)

```
DONE    Security, deterministic sim, CI gates, portal build flavors, short-landscape UX
NEXT    App Check enforcement, Monetization MVP, replay re-simulation enforcement
THEN    Portal submissions, growth loop, mobile/international expansion
```

### Recently completed foundation
- Security and integrity: anonymous-auth player writes, corroborated deletion, shared admin allowlist, Worker quota hardening, TTL-compatible fields, and App Check plumbing.
- Engine and replay trust: seeded deterministic simulation, fixed timestep, replay v3 action codec, required replay manifests, and admin `verifyRun` audit verdicts.
- Portal readiness: short-landscape layout, action-gated onboarding, asset diet, PWA freshness, production preview/SW deploy checks, and CrazyGames/Poki build flavors.
- Tooling: perf smoke, balance gate, Jest guardrails, engine/security suites, worker dry-run, and deploy preflight.

### Near-term execution
- Execute App Check enforcement after production token metrics are clean.
- Ship Monetization MVP: Stripe checkout, cosmetic/premium SKUs, and authenticated server-side entitlements. No pay-to-win.
- Promote replay re-simulation from admin audit data to soft flags, then rejection only after false positives are understood.
- Complete portal submission ops: account setup, store copy, screenshots, thumbnails, and external approval requests.

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

- Legit scored run is roughly 5-7 Firestore writes, plus sampled analytics when enabled.
- Anonymous auth and App Check plumbing reduce flood risk; complete the enforcement flip before paid promotion.
- Aggregated leaderboard reads are live; keep cache windows and aggregate docs intact before portal traffic.
- TTL raw `runCheckpoints`/replay chunks; keep durable aggregates.
- Export aggregates to BigQuery when analysis queries start hitting Firestore read pricing.
- Blaze upgrade decision point: sustained >2k runs/day or first monetization revenue, whichever comes first; set budget alerts the same day.

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
| Write flooding or invalid callable traffic | Anonymous auth is live; flip App Check enforcement before promotion and keep rate limits in Functions/Worker. |
| Read-quota exhaustion from menu traffic | Aggregated global-top doc; keep 30s caches |
| Forged-but-consistent replays on the ladder | Admin re-simulation audit exists; promote to soft flags, then rejection after false positives are understood. |
| Portal cert rejection (mobile) | Landscape layout + touch targets + a11y already strong; verify against CrazyGames/Poki checklists before submitting |
| Firestore telemetry cost scales with success | Sampling, TTL fields, cached reads, BigQuery export, and budget alerts. |
| Solo-dev bandwidth | Strict tier ordering above; mechanical-only refactors to protect velocity |
| Pay-to-win backlash | Cosmetics/convenience only; daily seed + boards free |

---

*The expensive half - instrumentation, simulation, replay-verified boards, consent/privacy scaffolding - is built. The remaining work is App Check enforcement, monetization, replay enforcement, portal submission ops, and growth experiments.*
