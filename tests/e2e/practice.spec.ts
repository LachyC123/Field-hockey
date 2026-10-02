import { expect, test } from '@playwright/test';

type Hook = { game: { phase: string; stroke: string; aimX: number; aimY: number; meter: number; strike(): void } };

test('title screen loads and a practice shot resolves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?quality=low');
  await expect(page.getByText('Shooting Practice')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Shooting Practice').click();
  await expect(page.locator('.scorebug')).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stickwork: Hook }).__stickwork.game.phase), { timeout: 40_000 })
    .toBe('aim');

  // A real drag-and-release on the canvas starts the wind-up.
  await page.mouse.move(200, 500);
  await page.mouse.down();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stickwork: Hook }).__stickwork.game.phase))
    .toBe('charging');
  await page.mouse.up();

  await expect(page.locator('.result-title')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.bug-shot')).toHaveText(/SHOT 1\/10/);
  expect(errors).toEqual([]);
});
