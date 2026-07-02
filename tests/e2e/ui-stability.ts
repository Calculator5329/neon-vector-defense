import { expect, type Page } from '@playwright/test';

type StableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutShiftEntry = {
  value: number;
  startTime: number;
  sources: string[];
};

const OBSERVER_FLAG = '__nvdLayoutShiftObserverInstalled';
const ENTRY_STORE = '__nvdLayoutShiftEntries';

declare global {
  interface Window {
    [OBSERVER_FLAG]?: boolean;
    [ENTRY_STORE]?: LayoutShiftEntry[];
  }
}

function installObserver() {
  window[ENTRY_STORE] = [];
  if (window[OBSERVER_FLAG]) return;
  window[OBSERVER_FLAG] = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        // Match CLS: ignore shifts adjacent to real user input.
        if (entry.hadRecentInput) continue;
        window[ENTRY_STORE]?.push({
          value: Number(entry.value ?? 0),
          startTime: Number(entry.startTime ?? 0),
          sources: (entry.sources ?? []).map((source: any) => {
            const node = source.node as Element | undefined;
            if (!node) return 'unknown';
            const testId = node.getAttribute?.('data-testid');
            if (testId) return `[data-testid="${testId}"]`;
            const id = node.id ? `#${node.id}` : '';
            const className = typeof node.className === 'string'
              ? `.${node.className.trim().replace(/\s+/g, '.')}`
              : '';
            return `${node.tagName.toLowerCase()}${id}${className}`;
          }),
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);
  } catch {
    // Older browsers simply skip the CLS stream; rect probes still run.
  }
}

export async function installLayoutShiftObserver(page: Page) {
  await page.addInitScript(installObserver);
}

export async function resetLayoutShiftObserver(page: Page) {
  await page.evaluate(() => {
    window.__nvdLayoutShiftEntries = [];
  });
}

export async function layoutShiftEntries(page: Page): Promise<LayoutShiftEntry[]> {
  return page.evaluate(() => window.__nvdLayoutShiftEntries ?? []);
}

export async function expectNoLayoutShifts(page: Page, label: string) {
  const entries = await layoutShiftEntries(page);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  expect(total, `${label} CLS entries: ${JSON.stringify(entries)}`).toBe(0);
}

export async function settleLayout(page: Page, ms = 175) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

export async function captureRects(page: Page, selectors: Record<string, string>) {
  return page.evaluate((items) => {
    const rects: Record<string, StableRect | null> = {};
    for (const [name, selector] of Object.entries(items)) {
      const el = document.querySelector(selector);
      if (!el) {
        rects[name] = null;
        continue;
      }
      const rect = el.getBoundingClientRect();
      let scrollLeft = window.scrollX;
      let scrollTop = window.scrollY;
      for (let node = el.parentElement; node; node = node.parentElement) {
        scrollLeft += node.scrollLeft;
        scrollTop += node.scrollTop;
      }
      rects[name] = {
        x: Math.round((rect.x + scrollLeft) * 10) / 10,
        y: Math.round((rect.y + scrollTop) * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    }
    return rects;
  }, selectors);
}

export function expectStableRects(
  before: Record<string, StableRect | null>,
  after: Record<string, StableRect | null>,
  label: string,
  tolerancePx = 1,
) {
  for (const [name, initial] of Object.entries(before)) {
    const next = after[name];
    expect(initial, `${label}: missing before rect for ${name}`).not.toBeNull();
    expect(next, `${label}: missing after rect for ${name}`).not.toBeNull();
    if (!initial || !next) continue;
    for (const prop of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(next[prop] - initial[prop]),
        `${label}: ${name}.${prop} before=${JSON.stringify(initial)} after=${JSON.stringify(next)}`,
      ).toBeLessThanOrEqual(tolerancePx);
    }
  }
}
