import { expect, test, type Page } from '@playwright/test';

const STAGES = ['compose', 'tokenize', 'embed', 'layers', 'attention', 'kvcache', 'sample', 'loop', 'stream'] as const;

interface Hook {
  scheduler: {
    events: Array<{ stage: string; baseDurationMs: number; type: string }>;
    getState(): { sourceDone: boolean; eventCount: number; cursor: number; playing: boolean; virtualTime: number };
    pause(): void;
    seekTime(ms: number): void;
    startOf(i: number): number;
  };
  useStore: {
    getState(): {
      setTourStep(s: number | null): void;
      setViewMode(m: 'cinema' | 'detail'): void;
      send(): Promise<void>;
      view: { currentStage: string | null };
    };
  };
}

declare global {
  interface Window {
    __tokenscope: Hook;
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function waitForRun(page: Page, view: 'cinema' | 'detail'): Promise<void> {
  await page.goto('/');
  await page.evaluate((v) => {
    const s = window.__tokenscope.useStore.getState();
    s.setTourStep(null);
    s.setViewMode(v);
  }, view);
  await page.getByRole('button', { name: /Start in Mock/ }).click();
  await page.waitForFunction(() => window.__tokenscope?.scheduler.getState().sourceDone === true, null, { timeout: 30_000 });
}

async function seekStage(page: Page, stage: string, frac = 0.6): Promise<void> {
  await page.evaluate(
    ([s, f]) => {
      const t = window.__tokenscope;
      t.scheduler.pause();
      const i = t.scheduler.events.findIndex((e) => e.stage === s);
      const ev = t.scheduler.events[i];
      if (!ev) throw new Error(`no events for stage ${s}`);
      t.scheduler.seekTime(t.scheduler.startOf(i) + ev.baseDurationMs * Number(f));
    },
    [stage, String(frac)],
  );
}

test('detail view: the mock run renders every stage without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await waitForRun(page, 'detail');
  for (const stage of STAGES) {
    await seekStage(page, stage);
    await page.waitForTimeout(1400);
    await expect(page.locator(`#stage-${stage}`)).toHaveAttribute('aria-current', 'step');
    await page.screenshot({ path: `e2e/screenshots/${stage}.png` });
  }
  expect(errors).toEqual([]);
});

test('cinema view: the 3-D world flies to every set', async ({ page }) => {
  const errors = collectErrors(page);
  await waitForRun(page, 'cinema');
  await expect(page.locator('canvas')).toBeVisible();
  for (const stage of STAGES) {
    await seekStage(page, stage, 0.7);
    await page.waitForTimeout(2200); // camera flight + springs
    const current = await page.evaluate(() => window.__tokenscope.useStore.getState().view.currentStage);
    expect(current).toBe(stage);
    await page.screenshot({ path: `e2e/screenshots/3d-${stage}.png` });
  }
  // Frame-rate sanity check: headless Chromium uses software GL (~13 fps here); a real GPU does ~60.
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.__tokenscope.scheduler.seekTime(1000);
        let frames = 0;
        const t0 = performance.now();
        const tick = (): void => {
          frames++;
          if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
          else resolve(frames / ((performance.now() - t0) / 1000));
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(fps).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});

test('transport: keyboard play/pause, stepping and the inspector', async ({ page }) => {
  await waitForRun(page, 'detail');
  await page.locator('main, body').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__tokenscope.scheduler.getState().playing)).toBe(false);
  const before = await page.evaluate(() => window.__tokenscope.scheduler.getState().cursor);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__tokenscope.scheduler.getState().cursor)).toBe(before + 2);
  await page.keyboard.press('Shift+ArrowRight');
  const stageAfter = await page.evaluate(() => window.__tokenscope.useStore.getState().view.currentStage);
  expect(stageAfter).not.toBeNull();
  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByText("What's happening")).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/inspector.png' });
});

test('live mode without a key fails loudly, not silently', async ({ page }) => {
  await waitForRun(page, 'detail');
  await page.getByRole('radio', { name: 'Live API' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/API key|Proxy|fetch/i, { timeout: 15_000 });
});
