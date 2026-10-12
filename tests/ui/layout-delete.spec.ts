import { test, expect, type Page } from './fixtures';
import { frontCamera } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
}

test('difficulty sits right of metadata, tools show all content, and speed reset never shifts transport', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const open of [false, true]) {
      if (open) await page.locator('#toggle-timeline').click();
      await expect.poll(async () => {
        const song = (await page.locator('.scene-song').boundingBox())!;
        const camera = (await page.locator('.scene-camera').boundingBox())!;
        return camera.y - song.y - song.height;
      }).toBeGreaterThanOrEqual(11);
      const info = (await page.locator('.song-details').boundingBox())!, difficulty = (await page.locator('.difficulty-bar').boundingBox())!;
      expect(difficulty.x).toBeGreaterThan(info.x + info.width); expect(difficulty.y).toBeCloseTo(info.y, 0);
      for (const mode of ['notes', 'obstacles', 'events']) {
        await page.locator(`[data-mode="${mode}"]`).click();
        const body = await page.locator('#tools-body').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
        expect(body.overflow).toBe('visible'); expect(body.scroll).toBe(body.height);
        const panel = (await page.locator('#tools-panel').boundingBox())!, transport = (await page.locator('.transport').boundingBox())!;
        expect(panel.y + panel.height).toBeLessThan(transport.y);
        expect(await page.locator('#check').evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })).toBe(true);
      }
      if (open) await page.locator('#toggle-timeline').click();
    }
    const positions = async () => Promise.all(['#seek', '#speed', '#metronome', '#volume'].map(s => page.locator(s).boundingBox()));
    const before = await positions();
    await page.locator('#speed').evaluate((el: HTMLInputElement) => { el.value = '.73'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(page.locator('#speed-reset')).toBeVisible(); expect(await positions()).toEqual(before);
    const reset = (await page.locator('#speed-reset').boundingBox())!, speed = (await page.locator('#speed').boundingBox())!;
    expect(reset.y + reset.height).toBeLessThan(speed.y);
    await page.locator('#speed-reset').click(); await expect(page.locator('#speed')).toHaveValue('1'); expect(await positions()).toEqual(before);
  }
  await page.screenshot({ path: 'test-results/layout-refinements.png' });
});

test('Del deletes selected walls over empty canvas or another wall, supports undo and hover fallback', async ({ page }) => {
  await fresh(page); await frontCamera(page); await page.keyboard.press('2');
  const wallPoint = (lane: number) => page.locator('#preview').evaluate((el: HTMLCanvasElement, lane) => {
    const p = el.spatialPreview!, point = p.screenPosition({ x: (lane - 1.5) * 1.15, y: 1.3, z: 0 }), b = el.getBoundingClientRect();
    return { x: b.x + point.x, y: b.y + point.y };
  }, lane);
  const count = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => (el.spatialPreview!.scene.getObjectByName('obstacles') as import('three').InstancedMesh).count);
  const first = await wallPoint(0), second = await wallPoint(2);
  await page.mouse.click(first.x, first.y); await page.mouse.click(second.x, second.y); expect(await count()).toBe(2);
  await page.keyboard.down('Alt'); await page.mouse.click(first.x, first.y); await page.keyboard.up('Alt');
  await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  await page.mouse.move(second.x, second.y); await page.keyboard.press('Delete'); expect(await count()).toBe(1);
  await page.keyboard.down('Alt'); await page.mouse.click(second.x, second.y); await page.keyboard.up('Alt');
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('2');
  const blank = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, b = el.getBoundingClientRect();
    for (let y = b.height * .3; y < b.height * .8; y += 20) for (let x = b.width * .35; x < b.width * .65; x += 20)
      if (document.elementFromPoint(b.x + x, b.y + y) === el && !p.pick(x, y)) return { x: b.x + x, y: b.y + y };
    throw new Error('No empty scene point');
  });
  await page.mouse.move(blank.x, blank.y); await page.keyboard.press('Delete'); expect(await count()).toBe(0);
  await page.keyboard.press('Control+z'); expect(await count()).toBe(1);
  await expect(page.locator('#selection-count')).toHaveText('未选中');
  await page.mouse.move(second.x, second.y); await page.keyboard.press('Delete'); expect(await count()).toBe(0);
});
