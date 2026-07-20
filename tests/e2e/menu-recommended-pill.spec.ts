import { expect, test, type Page } from '@playwright/test';

// Regression guard for the first-time "RECOMMENDED" protocol pill.
//
// Bug (2026-07-20 NVD feedback): the difficulty dock became a two-column grid
// (.diff-card.atlas-protocol-row: `name | desc`), but the static .start-pill was
// still emitted as a plain child. Grid auto-placement dropped the pill into
// col-1/row-1 and shoved the protocol name ("Recruit") into col-2 beside it,
// with the description wrapping to row-2 — the spacing was visibly broken.
//
// The pill only renders for a first-time player (progress.runs < 1) AND only on
// a NON-active protocol card, so we seed a fresh player and select Veteran to
// expose the RECOMMENDED pill on the Recruit card — exactly the reported state.

const firstTimeProgress = {
  archive: [],
  best: {},
  totalWaves: 0,
  runs: 0, // < 1 => firstTime => RECOMMENDED / START HERE pills render
  victories: 0,
  kills: 0,
  blueprints: {},
  history: [],
  playerName: '',
  clearedMaps: [],
  tut: true,
  cloakTip: true,
};

async function seedFirstTimePlayer(page: Page) {
  await page.addInitScript((base) => {
    window.localStorage.setItem('nvd-progress-v1', JSON.stringify(base));
    // Adult consent so the age gate never blocks the harness.
    window.localStorage.setItem(
      'nvd-consent-v1',
      JSON.stringify({ ageBand: 'adult', sell: 'ok', gpc: false, ts: 1 }),
    );
  }, firstTimeProgress);
}

test.describe('first-time RECOMMENDED protocol pill', () => {
  test('pill sits on its own row and never collides with the protocol name', async ({ page }) => {
    await seedFirstTimePlayer(page);
    await page.goto('/');
    await expect(page.getByTestId('deploy-button')).toBeVisible();

    // Recruit (easy) is the default-active protocol, which suppresses its own
    // pill (`!active` guard). Selecting Veteran (normal) exposes RECOMMENDED on
    // the Recruit card — the exact state from the bug report.
    await page.getByTestId('diff-card-normal').click();

    const pill = page.locator('[data-testid="diff-card-easy"] .start-pill');
    await expect(pill, 'RECOMMENDED pill should render for a first-time player').toBeVisible();
    await expect(pill).toHaveText(/RECOMMENDED/);

    const geom = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="diff-card-easy"]') as HTMLElement;
      const rect = (sel: string) =>
        (card.querySelector(sel) as HTMLElement).getBoundingClientRect();
      const p = rect('.start-pill');
      const n = rect('.diff-name');
      const d = rect('.diff-desc');
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return {
        pillBottom: p.bottom,
        nameTop: n.top,
        pillOverlapsName: overlaps(p, n),
        pillOverlapsDesc: overlaps(p, d),
        nameDescSameRow: Math.abs(n.top - d.top) < 6,
      };
    });

    // The defect signature (both viewports): the pill shared a row with the
    // name, so its bottom edge dropped level with / below the name's top.
    expect(geom.pillBottom, 'pill must sit ABOVE the protocol name, not beside it').toBeLessThanOrEqual(
      geom.nameTop + 1,
    );
    expect(geom.pillOverlapsName, 'pill must not overlap the protocol name').toBe(false);
    expect(geom.pillOverlapsDesc, 'pill must not overlap the protocol description').toBe(false);

    // On the wide dock the broken layout also forced the description onto its own
    // row (name in col-1/row-1 beside the pill, desc alone in row-2). Narrow
    // mobile cards legitimately stack name over desc, so only assert the shared
    // row on desktop widths.
    const isWide = (page.viewportSize()?.width ?? 0) >= 700;
    if (isWide) {
      expect(geom.nameDescSameRow, 'name + description should share one row beneath the pill').toBe(true);
    }

    // Visual guard: freeze animation and pixel-snapshot the protocol dock so
    // future spacing/placement regressions are also caught by image diff. The
    // element screenshot excludes the animated starfield background, so it is
    // stable. (Baseline regenerates with `--update-snapshots`.)
    //
    // Only the linux baseline is committed; the geometric assertions above are
    // the cross-platform guard, so skip the pixel diff where no baseline exists
    // rather than fail a Windows/mac run on a missing snapshot.
    if (process.platform === 'linux') {
      await expect(page.getByTestId('diff-row')).toHaveScreenshot('recommended-pill-dock.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      });
    }
  });
});
