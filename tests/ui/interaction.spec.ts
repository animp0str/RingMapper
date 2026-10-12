import { test, expect, type Page } from '@playwright/test';
import { selectLastVisibleNote, unitDepth, frontCamera } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
  await frontCamera(page);
  await expect(page.locator('#note-count')).toHaveText('0');
}
async function point(page: Page, kind: 'notes' | 'ringNotes', col: number, layer = 0, rotation = 0, reverse = false, depth = 0) {
  const p = await page.evaluate(async ({ kind, col, layer, rotation, reverse, depth }) => {
    const preview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { handWorldPosition, footX, stage } = await import(layoutPath);
    const xy = kind === 'notes' ? handWorldPosition(col, layer, rotation, reverse) : { x: footX(col), y: stage.footY };
    return preview.screenPosition({ ...xy, z: depth });
  }, { kind, col, layer, rotation, reverse, depth });
  const box = await page.locator('#preview').boundingBox(); return { x: box!.x + p.x, y: box!.y + p.y };
}
async function drag(page: Page, from: {x: number; y: number}, to: {x: number; y: number}) {
  await page.keyboard.down('Alt'); await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 }); await page.mouse.up(); await page.keyboard.up('Alt');
}
async function field(page: Page, key: string, value: string) {
  await page.locator(`[data-field="${key}"]`).fill(value); await page.locator(`[data-field="${key}"]`).dispatchEvent('change');
}

test('direct target clicks place unselected notes in the combined note mode', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('[data-tool]')).toHaveCount(0);
  const ring = await point(page, 'notes', 0, 2); await page.mouse.click(ring.x, ring.y);
  await expect(page.locator('#note-count')).toHaveText('1'); await expect(page.locator('#selection-count')).toHaveText('未选中');
  await expect(page.locator('[data-field]')).toHaveCount(0);
  // Clicking the same occupied position selects; it does not duplicate the note.
  await page.mouse.click(ring.x, ring.y); await expect(page.locator('#note-count')).toHaveText('1');
  await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('2');
  await field(page, 'time', '.25');
  // The transparent ring can still place at the playhead with a future note behind it.
  await page.mouse.click(ring.x, ring.y); await expect(page.locator('#note-count')).toHaveText('2');
  await expect(page.locator('#selection-count')).toHaveText('未选中');
  const foot = await page.evaluate(async () => {
    const el = document.querySelector('#preview') as HTMLCanvasElement, p = el.spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { footX, stage } = await import(layoutPath);
    const position = p.screenPosition({ x: footX(18), y: stage.footY - .1, z: .35 }), box = el.getBoundingClientRect();
    return { x: box.x + position.x, y: box.y + position.y };
  });
  await page.mouse.click(foot.x, foot.y);
  await expect(page.locator('#note-count')).toHaveText('3'); await expect(page.locator('#selection-count')).toHaveText('未选中');
  await expect(page.locator('[data-mode="notes"]')).toHaveClass(/active/);
  await selectLastVisibleNote(page, 'ringNotes'); await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('18');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    let count = 0; el.spatialPreview!.scene.traverse((o: any) => { if (o.isSprite && o.name !== 'lighting-track-label') count++; }); return count;
  })).toBe(0);
  // Timeline and toolbar creation follow the same unselected default.
  await page.locator('[data-mode="notes"]').click(); await page.locator('#add-at-beat').click();
  await expect(page.locator('#selection-count')).toHaveText('未选中');
  await page.locator('#toggle-timeline').click();
  await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const timeline = await page.locator('#timeline').boundingBox();
  await page.mouse.click(timeline!.x + 230, timeline!.y + 49 / 524 * timeline!.height);
  await expect(page.locator('#selection-count')).toHaveText('未选中'); await expect(page.locator('#note-count')).toHaveText('5');
});

test('camera reset and scene buttons return focus; Space plays once and retains note selection', async ({ page }) => {
  await fresh(page); await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await page.locator('#camera-reset').click(); await expect(page.locator('#preview')).toBeFocused();
  await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  await page.keyboard.down('Space'); await page.waitForTimeout(180); await page.keyboard.down('Space'); await page.keyboard.up('Space');
  await expect(page.locator('#play .lucide-pause')).toBeVisible(); await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  await page.keyboard.press('Space'); await expect(page.locator('#play .lucide-play')).toBeVisible();
  await page.locator('#camera-reset').click(); await expect(page.locator('#preview')).toBeFocused();
  await page.locator('#toggle-timeline').click(); await page.locator('#division').selectOption('8'); await expect(page.locator('#preview')).toBeFocused();
  await page.locator('#hide-timeline').click(); await expect(page.locator('#preview')).toBeFocused();
  await page.locator('#toggle-tools').click(); await page.keyboard.press('Space'); await expect(page.locator('#play .lucide-pause')).toBeVisible();
  await page.keyboard.press('Space'); await expect(page.locator('#play .lucide-play')).toBeVisible();
  await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  // Text input keeps its normal typing behavior instead of invoking playback.
  await page.locator('#search').fill('a'); await page.keyboard.press('Space'); await expect(page.locator('#search')).toHaveValue('a ');
  await expect(page.locator('#play .lucide-play')).toBeVisible();
  await page.locator('#search').fill(''); await page.keyboard.press('Enter'); await expect(page.locator('#preview')).toBeFocused();
  await page.keyboard.press('Space'); await expect(page.locator('#play .lucide-pause')).toBeVisible();
});

test('Alt-drag moves hand and hold positions with one undo and works in rotated and resized views', async ({ page }) => {
  await fresh(page);
  const from = await point(page, 'notes', 0, 2); await page.mouse.click(from.x, from.y);
  await drag(page, from, await point(page, 'notes', 2, 0));
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('2'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('0');
  await expect(page.locator('[data-field="time"]')).toHaveValue('0'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#undo').click(); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('2');
  await page.locator('#redo').click(); await selectLastVisibleNote(page); await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('2');
  await field(page, 'cutDirection', '3'); await field(page, 'time', '1');
  await page.locator('#camera-reset').click();
  await page.locator('#toggle-timeline').click();
  await drag(page, await point(page, 'notes', 2, 0, 0, false, -1.65), await point(page, 'notes', 3, 1, 0, false, -1.65));
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('3'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('1');
  await expect(page.locator('[data-field="time"]')).toHaveValue('1'); await expect(page.locator('[data-field="cutDirection"]')).toHaveValue('3');
  await page.locator('#hide-timeline').click(); await frontCamera(page);
  await page.locator('[data-mode="notes"]').click(); await page.locator('#hold-add').click(); await selectLastVisibleNote(page, 'ringNotes');
  await field(page, 'duration', '4');
  await drag(page, await point(page, 'ringNotes', 0), await point(page, 'ringNotes', 30));
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('30');
  await expect(page.locator('[data-field="ringNoteType"]')).toHaveValue('1'); await expect(page.locator('[data-field="duration"]')).toHaveValue('4');
  await page.locator('#undo').click(); await selectLastVisibleNote(page, 'ringNotes');
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); await expect(page.locator('[data-field="duration"]')).toHaveValue('4');
});
