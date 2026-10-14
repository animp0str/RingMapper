import { test, expect, type Page } from './fixtures';
import { selectLastVisibleNote } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
}
async function field(page: Page, name: string, value: string) {
  await page.locator(`[data-field="${name}"]`).fill(value); await page.locator(`[data-field="${name}"]`).dispatchEvent('change');
}
async function hand(page: Page, col: number, row: number) {
  return page.locator('#preview').evaluate(async (el: HTMLCanvasElement, [col, row]) => {
    const layout = '/src/layout.ts', { handWorldPosition } = await import(layout), p = el.spatialPreview!;
    const point = p.screenPosition(handWorldPosition(col, row)), box = el.getBoundingClientRect(); return { x: point.x + box.x, y: point.y + box.y };
  }, [col, row]);
}
async function clickHand(page: Page, col: number, row: number) { const p = await hand(page, col, row); await page.mouse.click(p.x, p.y); }

test('signed foot labels, centered camera, opacity slider and illustrated mirror buttons replace obsolete controls', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('#camera-preset, #ring-rotation, #toggle-color, [data-tool]')).toHaveCount(0);
  await expect(page.locator('.preview-hud')).not.toContainText('WEBGL'); await expect(page.locator('.preview-beat')).toHaveCount(0);
  expect(await page.locator('[data-mode]').allTextContents()).toEqual(['音符', '障碍物', '灯光事件']);
  const camera = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => ({ x: el.spatialPreview!.camera.position.x, y: el.spatialPreview!.camera.position.y, targetY: el.spatialPreview!.controls.target.y }));
  expect(camera.x).toBeCloseTo(0); expect(camera.y).toBeGreaterThan(camera.targetY + 3);
  await page.locator('#view-settings').click(); await page.locator('#ring-opacity').fill('48'); await page.locator('#ring-opacity').dispatchEvent('input');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.ringOpacity)).toBe(.48); await page.locator('#view-apply').click();
  for (const index of [35,18,17,0]) {
    await page.locator('[data-mode="notes"]').click(); await page.locator('#add-foot').click(); await selectLastVisibleNote(page, 'ringNotes'); await field(page, 'lineIndex', String(index));
  }
  const tracks = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.scene.children.filter(n => n.name === 'foot-track-label').map(n => n.userData.track));
  expect(tracks.sort((a, b) => a - b)).toEqual([-18,-1,1,18]);
  const buttons = await page.locator('.mirror-controls button').all();
  for (const button of buttons) { await expect(button.locator('svg')).toBeVisible(); const box = await button.boundingBox(); expect(Math.abs(box!.width - box!.height)).toBeLessThan(2); }
  await page.screenshot({ path: 'test-results/signed-foot-tracks.png' });
});

test('wheel moves forward upwards, reverses persistently, and Ctrl wheel cycles preset denominators without seeking', async ({ page }) => {
  await fresh(page); const box = await page.locator('#preview').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.wheel(0, -100);
  await expect(page.locator('#beat-input')).toHaveValue('0.250');
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect(page.locator('#division')).toHaveValue('6'); await expect(page.locator('#snap-denominator')).toHaveValue('6');
  await expect(page.locator('#beat-input')).toHaveValue('0.250');
  await page.locator('#snap-denominator').fill('5'); await page.keyboard.press('Enter');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control');
  await expect(page.locator('#division')).toHaveValue('4');
  await page.locator('#view-settings').click(); await page.locator('#wheel-reverse').check(); await page.locator('#view-apply').click();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.wheel(0, 100); await expect(page.locator('#beat-input')).toHaveValue('0.500');
  expect(await page.evaluate(() => localStorage.getItem('ringmapper-wheel-reverse'))).toBe('true');
  await page.locator('#view-settings').click(); await expect(page.locator('#wheel-reverse')).toBeChecked(); await page.locator('#view-apply').click();
});

test('selected objects show cyan edges, nearby grouping works, and double click selects every group member', async ({ page }) => {
  await fresh(page); await clickHand(page, 0, 0); await clickHand(page, 2, 0);
  const first = await hand(page, 0, 0), second = await hand(page, 2, 0);
  await page.mouse.click(first.x, first.y); await page.keyboard.down('Shift'); await page.mouse.click(second.x, second.y); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).toHaveText('已选 2 项'); await expect(page.locator('.selection-marker:not([hidden])')).toHaveCount(2);
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.scene.children.filter(n => n.name === 'selected-note-edge' && n.visible).length)).toBe(2);
  await expect(page.locator('#quick-group')).toBeVisible(); await expect(page.locator('#quick-group')).toBeEnabled(); await page.locator('#quick-group').click();
  await expect(page.locator('[data-field="groupId"]')).not.toHaveValue('');
  await page.keyboard.press('Escape'); await expect(page.locator('#quick-group')).toBeHidden();
  await page.mouse.dblclick(first.x, first.y); await expect(page.locator('#selection-count')).toHaveText('已选 2 项');
  await expect(page.locator('#note-count')).toHaveText('2');
  await page.screenshot({ path: 'test-results/selection-and-group.png' });
});

test('overlap diagnostics appear locally and globally after paste and edits, resolve immediately, and return on undo', async ({ page }) => {
  await fresh(page); await clickHand(page, 2, 0); await selectLastVisibleNote(page);
  await page.locator('#copy').click(); await page.locator('#paste').click();
  await expect(page.locator('#overlap-status')).toContainText('beat 0'); await expect(page.locator('.overlap-marker:not([hidden])')).toHaveCount(1);
  await field(page, 'time', '20'); await expect(page.locator('#overlap-status')).toBeHidden();
  await page.locator('#undo').click(); await expect(page.locator('#overlap-status')).toBeVisible();
  await page.locator('#overlap-status').click(); await page.locator('[data-overlap="0"]').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 2 项');
  await page.screenshot({ path: 'test-results/overlap-diagnostic.png' });
  // Delete removes the whole selection even when hovering a coincident object.
  const p = await hand(page, 2, 0); await page.mouse.move(p.x, p.y); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('0'); await expect(page.locator('#overlap-status')).toBeHidden();
  await page.keyboard.press('Control+z'); await expect(page.locator('#note-count')).toHaveText('2');
  await expect(page.locator('#overlap-status')).toBeVisible(); await page.keyboard.press('Escape');
  await page.mouse.move(p.x, p.y); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('1'); await expect(page.locator('#overlap-status')).toBeHidden();
  await expect(page.locator('.overlap-marker:not([hidden])')).toHaveCount(0);
});

test('obstacle mode exposes four ground tracks, places only walls, and preserves the half-wall opening for picking', async ({ page }) => {
  await fresh(page); await page.locator('[data-mode="obstacles"]').click();
  const pad = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => { const p = el.spatialPreview!, target = p.scene.getObjectByName('obstacle-slot-3')!; const point = p.screenPosition({ x: target.position.x, y: target.position.y + .035, z: target.position.z - .25 }), b = el.getBoundingClientRect(); return { x: b.x + point.x, y: b.y + point.y }; });
  await page.mouse.click(pad.x, pad.y); await expect(page.locator('#note-count')).toHaveText('0');
  const wall = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => { const p = el.spatialPreview!, mesh = p.scene.getObjectByName('obstacles') as import('three').InstancedMesh; const a = mesh.instanceMatrix.array; const lower = p.screenPosition({ x: a[12], y: .8, z: 0 }), upper = p.screenPosition({ x: a[12], y: 2.5, z: 0 }); return { count: mesh.count, height: a[5], y: a[13], lower: p.pick(lower.x, lower.y, 'notes'), upper: p.pick(upper.x, upper.y, 'notes') }; });
  expect(wall.count).toBe(1); expect(wall.height).toBeCloseTo(1.55); expect(wall.y - wall.height / 2).toBeCloseTo(1.7);
  expect(wall.lower).toBeUndefined(); expect(wall.upper).toMatchObject({ kind: 'obstacles', index: 0 });
  await clickHand(page, 0, 0); await expect(page.locator('#note-count')).toHaveText('0');
  await page.locator('[data-mode="notes"]').click();
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.scene.getObjectByName('obstacle-slot-0')!.visible)).toBe(false);
});

test('the second original Caocao RingDance Hard obstacle renders as an upper half wall', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('[data-chart="RingDance/HardRingDance.yaml"]').click(); await expect(page.locator('#scene-workspace')).toHaveAttribute('data-current-chart', 'RingDance/HardRingDance.yaml');
  await page.locator('[data-mode="obstacles"]').click(); await page.locator('#beat-input').fill('5'); await page.locator('#beat-input').dispatchEvent('change');
  const wall = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => { const mesh = el.spatialPreview!.scene.getObjectByName('obstacles') as import('three').InstancedMesh; const index = mesh.userData.batch.records.findIndex((r: any) => r.hit.index === 1), a = mesh.instanceMatrix.array; return { index, y: a[index * 16 + 13], height: a[index * 16 + 5] }; });
  expect(wall.index).toBeGreaterThanOrEqual(0); expect(wall.height).toBeCloseTo(1.55); expect(wall.y - wall.height / 2).toBeCloseTo(1.7);
  await page.screenshot({ path: 'test-results/caocao-half-wall.png' });
});

test('tap BPM starts song audio once and subsequent taps keep playback running', async ({ page }) => {
  await page.addInitScript(() => { const play = HTMLMediaElement.prototype.play; (window as any).playCalls = 0; HTMLMediaElement.prototype.play = function() { (window as any).playCalls++; return play.call(this); }; });
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#settings').click(); await page.locator('#tap-tempo').click(); await expect(page.locator('#play .lucide-pause')).toBeVisible();
  await page.waitForTimeout(350); await page.locator('#tap-tempo').click();
  expect(await page.evaluate(() => (window as any).playCalls)).toBe(1);
  await expect(page.locator('#play .lucide-pause')).toBeVisible(); await expect(page.locator('#tap-tempo')).toContainText('BPM');
});
