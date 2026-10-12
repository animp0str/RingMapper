import { test, expect, type Page } from '@playwright/test';
import { selectLastVisibleNote, unitDepth, frontCamera } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
  await frontCamera(page);
}
async function handPoint(page: Page, col: number, row: number, depth = 0) {
  return page.evaluate(async ({ col, row, depth }) => {
    const canvas = document.querySelector('#preview') as HTMLCanvasElement, p = canvas.spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { handWorldPosition } = await import(layoutPath);
    const point = p.screenPosition({ ...handWorldPosition(col, row), z: depth }), box = canvas.getBoundingClientRect();
    return { x: point.x + box.x, y: point.y + box.y };
  }, { col, row, depth });
}
async function clickHand(page: Page, col: number, row: number) { const p = await handPoint(page, col, row); await page.mouse.click(p.x, p.y); }
async function setBeat(page: Page, value: number) { await page.locator('#beat-input').fill(String(value)); await page.locator('#beat-input').dispatchEvent('change'); }
async function color(page: Page) {
  return page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const mesh = el.spatialPreview!.scene.getObjectByName('hand-notes') as import('three').InstancedMesh;
    return Array.from(mesh.instanceColor!.array).slice(0, 3);
  });
}

test('Shift blocks placement and draw buttons; Q changes placement color without whitening the selection', async ({ page }) => {
  await fresh(page);
  await page.keyboard.down('Shift');
  await page.locator('#add-at-beat').click();
  await expect(page.locator('[data-tool]')).toHaveCount(0);
  await clickHand(page, 0, 2); await expect(page.locator('#note-count')).toHaveText('0');
  await page.locator('[data-mode="notes"]').click(); await page.locator('#hold-add').click();
  await expect(page.locator('#note-count')).toHaveText('0'); await page.keyboard.up('Shift');
  await page.keyboard.press('q'); await expect(page.locator('[data-color="1"]')).toHaveClass('active');
  await clickHand(page, 0, 2); await expect(page.locator('#note-count')).toHaveText('1');
  const unselected = await color(page); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="type"]')).toHaveValue('1'); expect(await color(page)).toEqual(unselected);
  expect(unselected[2]).toBeGreaterThan(unselected[0] * 8);
  expect(await page.locator('#preview').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.keyboard.press('q'); await expect(page.locator('#toggle-color')).toHaveCount(0);
  await expect(page.locator('[data-field="type"]')).toHaveValue('1'); // Existing notes keep their color.
  await clickHand(page, 0, 0); await selectLastVisibleNote(page); await expect(page.locator('[data-field="type"]')).toHaveValue('0');
  await page.locator('#toggle-timeline').click();
  await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const box = await page.locator('#timeline').boundingBox();
  await page.keyboard.down('Shift'); await page.mouse.click(box!.x + 230, box!.y + 49 / 524 * box!.height); await page.keyboard.up('Shift');
  await expect(page.locator('#note-count')).toHaveText('2');
  // Q must remain a normal character in text inputs.
  await page.locator('#search').fill(''); await page.keyboard.press('q'); await expect(page.locator('#search')).toHaveValue('q');
  await expect(page.locator('#toggle-color')).toHaveCount(0);
});

test('Delete prioritizes selected notes over hover, then supports hover deletion in 3D and timeline', async ({ page }) => {
  await fresh(page); await clickHand(page, 0, 2); await clickHand(page, 2, 0);
  const first = await handPoint(page, 0, 2), second = await handPoint(page, 2, 0);
  await page.keyboard.down('Alt'); await page.mouse.click(first.x, first.y); await page.keyboard.up('Alt');
  await page.mouse.move(second.x, second.y); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('1'); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('2'); await page.keyboard.press('Escape');
  await page.mouse.move(first.x, first.y);
  await page.keyboard.press('Delete'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#undo').click(); await expect(page.locator('#selection-count')).toHaveText('未选中');
  await page.mouse.move(first.x, first.y); await page.keyboard.press('Delete'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#toggle-timeline').click();
  await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const box = await page.locator('#timeline').boundingBox();
  await page.mouse.move(box!.x + 88, box!.y + 135.6 / 524 * box!.height); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('0');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('1');
});

test('3D spacing stretches notes, holds and numbered floor beats together; geometry is thicker', async ({ page }) => {
  await fresh(page); await setBeat(page, 4); await page.locator('#add-at-beat').click();
  await page.locator('[data-mode="notes"]').click(); await page.locator('#hold-add').click(); await selectLastVisibleNote(page, 'ringNotes');
  await page.locator('[data-field="duration"]').fill('4'); await page.locator('[data-field="duration"]').dispatchEvent('change');
  await setBeat(page, 0);
  const snapshot = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, hand = p.scene.getObjectByName('hand-notes') as import('three').InstancedMesh;
    const hold = p.scene.getObjectByName('foot-holds') as import('three').InstancedMesh;
    const positions = Array.from(hand.geometry.getAttribute('position').array).filter((_, i) => i % 3 === 2);
    const labels = p.scene.children.filter(o => o.name === 'ground-beat-label' && o.visible);
    return { handZ: hand.instanceMatrix.array[14], holdLength: hold.instanceMatrix.array[10], depth: Math.max(...positions) - Math.min(...positions),
      beats: labels.map(o => o.userData.beat), beat4: labels.find(o => o.userData.beat === 4)!.position.z,
      floorLabel: labels.every(o => Math.abs(o.position.y - .18) < .001 && Math.abs(o.quaternion.dot(p.camera.quaternion)) > .999) };
  });
  const before = await snapshot(); expect(before.depth).toBeGreaterThan(.3); expect(before.floorLabel).toBe(true); expect(before.beats).toEqual([0,1,2,3,4,5,6,7,8]);
  await page.locator('#depth-zoom').evaluate((el: HTMLInputElement) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#depth-zoom-value')).toHaveText('2.00×'); const after = await snapshot();
  expect(after.handZ).toBeCloseTo(before.handZ * 2); expect(after.holdLength).toBeCloseTo(before.holdLength * 2); expect(after.beat4).toBeCloseTo(before.beat4 * 2);
  const distant = await handPoint(page, 0, 0, after.handZ); await page.mouse.move(distant.x, distant.y); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('1'); // Raycasting follows the stretched geometry.
  await page.locator('#undo').click(); await setBeat(page, 2); expect((await snapshot()).beats[0]).toBe(2);
  await setBeat(page, 4); await selectLastVisibleNote(page); await expect(page.locator('[data-field="time"]')).toHaveValue('4');
  await page.locator('#camera-reset').click(); await page.screenshot({ path: 'test-results/ground-beats.png' });
});

test('mirror controls apply top-bottom and diagonal transforms and support undo', async ({ page }) => {
  await fresh(page); await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await page.locator('[data-field="cutDirection"]').fill('4'); await page.locator('[data-field="cutDirection"]').dispatchEvent('change');
  await page.locator('#mirror-up-down').click();
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('2');
  await expect(page.locator('[data-field="type"]')).toHaveValue('0'); await expect(page.locator('[data-field="cutDirection"]')).toHaveValue('4');
  await page.locator('#mirror-diagonal').click();
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('3'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('0');
  await expect(page.locator('[data-field="type"]')).toHaveValue('0'); await expect(page.locator('[data-field="cutDirection"]')).toHaveValue('4');
  await page.locator('#undo').click(); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('2');
});
