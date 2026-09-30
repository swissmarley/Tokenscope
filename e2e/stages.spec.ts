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
  useStore: { getState(): { setTourStep(s: number | null): void; send(): Promise<void>; view: { currentStage: string | null } } };
}

declare global {
  interface Window {
    __tokenscope: Hook;
  }
}

async function waitForRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.__tokenscope.useStore.getState().setTourStep(null));
  await page.getByRole('button', { name: /Start in Mock/ }).click();
  await page.waitForFunction(() => window.__tokenscope?.scheduler.getState().sourceDone === true, null, { timeout: 30_000 });
}

test('the mock run renders every stage without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await waitForRun(page);

  for (const stage of STAGES) {
    await page.evaluate((s) => {
      const t = window.__tokenscope;
      t.scheduler.pause();
      const i = t.scheduler.events.findIndex((e) => e.stage === s);
      const ev = t.scheduler.events[i];
      if (!ev) throw new Error(`no events for stage ${s}`);
      t.scheduler.seekTime(t.scheduler.startOf(i) + ev.baseDurationMs * 0.6);
    }, stage);
    await page.waitForTimeout(1400);
    await expect(page.locator(`#stage-${stage}`)).toHaveAttribute('aria-current', 'step');
    await page.screenshot({ path: `e2e/screenshots/${stage}.png` });
  }
  expect(errors).toEqual([]);
});

test('transport: keyboard play/pause, stepping and the inspector', async ({ page }) => {
  await waitForRun(page);
  await page.locator('main, body').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  expect((await page.evaluate(() => window.__tokenscope.scheduler.getState().playing))).toBe(false);
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
  await waitForRun(page);
  await page.getByRole('radio', { name: 'Live API' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/API key|Proxy|fetch/i, { timeout: 15_000 });
});
