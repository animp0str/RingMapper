import { test, expect, type Page } from '@playwright/test';
import { selectLastVisibleNote, frontCamera } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
  await frontCamera(page);
}
async function slider(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).evaluate((el: HTMLInputElement, v) => {
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function footPoint(page: Page) {
  return page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, mesh = p.scene.getObjectByName('foot-notes') as import('three').InstancedMesh;
    const record = mesh.userData.batch.records[0], point = p.screenPosition(record.position), box = el.getBoundingClientRect();
    return { x: box.x + point.x, y: box.y + point.y };
  });
}
async function footState(page: Page) {
  return page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const mesh = el.spatialPreview!.scene.getObjectByName('foot-holds') as import('three').InstancedMesh;
    return { count: mesh.count, length: mesh.instanceMatrix.array[10], spacing: el.spatialPreview!.beatSpacing };
  });
}

test('scene snap presets and custom beats drive placement without opening the timeline', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('.scene-camera #division')).toBeVisible();
  expect(await page.locator('#division option').evaluateAll(opts => opts.map(o => (o as HTMLOptionElement).value))).toEqual(['1','2','3','4','6','8','16','24','32','custom']);
  await expect(page.locator('#timeline-panel')).toBeHidden();
  await page.locator('#division').selectOption('3'); await expect(page.locator('#preview')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  expect(Number(await page.locator('[data-field="time"]').inputValue())).toBeCloseTo(1 / 3, 9);
  await page.locator('#division').selectOption('custom'); await expect(page.locator('#snap-denominator')).toBeFocused();
  await page.locator('#snap-denominator').fill('5'); await page.keyboard.press('Enter');
  await expect(page.locator('#preview')).toBeFocused(); await expect(page.locator('#division')).toHaveValue('custom');
  await page.locator('#home').click(); await page.keyboard.press('ArrowRight'); await expect(page.locator('#beat-input')).toHaveValue('0.200');
  await page.locator('#snap-denominator').fill('0'); await page.keyboard.press('Enter');
  await expect(page.locator('#snap-denominator')).toHaveValue('5'); await expect(page.locator('#toast')).toContainText('正数');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#beat-input')).toHaveValue('0.400');
});

test('Alt wheel edits the hovered foot in snap steps, converts both ways and supports undo without seeking', async ({ page }) => {
  await fresh(page); await page.locator('[data-mode="notes"]').click(); await page.locator('#add-foot').click();
  await expect(page.locator('#selection-count')).toHaveText('未选中');
  await page.locator('#division').selectOption('3');
  const p = await footPoint(page); await page.mouse.move(p.x, p.y); await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await footState(page)).count).toBe(1);
  let state = await footState(page); expect(state.length / state.spacing).toBeCloseTo(1 / 3, 6);
  await expect(page.locator('#beat-input')).toHaveValue('0.000'); await expect(page.locator('#selection-count')).toHaveText('未选中');
  await page.mouse.wheel(0, -200); await expect.poll(async () => { const s = await footState(page); return s.length / s.spacing; }).toBeCloseTo(1, 6);
  await page.mouse.wheel(0, 300); await expect.poll(async () => (await footState(page)).count).toBe(0);
  await page.keyboard.up('Alt'); await selectLastVisibleNote(page, 'ringNotes');
  await expect(page.locator('[data-field="duration"]')).toHaveValue('0'); await expect(page.locator('[data-field="ringNoteType"]')).toHaveValue('0');
  await page.locator('#undo').click(); await selectLastVisibleNote(page, 'ringNotes');
  expect(Number(await page.locator('[data-field="duration"]').inputValue())).toBeCloseTo(1, 8);
  await expect(page.locator('[data-field="ringNoteType"]')).toHaveValue('1');
  await page.locator('#snap-denominator').fill('5'); await page.keyboard.press('Enter');
  await page.mouse.move(p.x, p.y); await page.keyboard.down('Alt'); await page.mouse.wheel(0, -100); await page.keyboard.up('Alt');
  await expect.poll(async () => { const s = await footState(page); return s.length / s.spacing; }).toBeCloseTo(1.2, 6);
  await expect(page.locator('#beat-input')).toHaveValue('0.000');
  // Ordinary wheel still seeks, even over a foot note.
  await page.mouse.wheel(0, -100); await expect(page.locator('#beat-input')).toHaveValue('0.200');
});

test('depth and timeline share zoom; external continuous preview range extends the camera clipping plane', async ({ page }) => {
  await fresh(page); await expect(page.locator('#depth-zoom')).toHaveValue('5');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.depthScale)).toBe(5);
  await page.locator('#toggle-timeline').click();
  await expect(page.locator('#zoom, .timeline-hint, .preview-footer, .preview-events, #loop, #mirror-mode')).toHaveCount(0);
  await expect(page.locator('.mirror-controls button')).toHaveCount(3);
  await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const timeline = await page.locator('#timeline').boundingBox();
  await page.mouse.click(timeline!.x + 86 + 240, timeline!.y + 15); await expect(page.locator('#beat-input')).toHaveValue('1.000');
  await slider(page, 'depth-zoom', 10); await expect(page.locator('#depth-zoom-value')).toHaveText('10.00×');
  await page.mouse.click(timeline!.x + 86 + 480, timeline!.y + 15); await expect(page.locator('#beat-input')).toHaveValue('1.000');
  await page.mouse.move(timeline!.x + 200, timeline!.y + 50); await page.keyboard.down('Control'); await page.mouse.wheel(0, 100); await page.keyboard.up('Control');
  await expect.poll(async () => Number(await page.locator('#depth-zoom').inputValue())).toBe(10);
  await expect(page.locator('#division')).toHaveValue('3');
  await slider(page, 'preview-range', 24.75); await expect(page.locator('#preview-range-value')).toHaveText('24.75 拍');
  const state = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => ({ ahead: el.spatialPreview!.lookAhead, far: el.spatialPreview!.camera.far, spacing: el.spatialPreview!.beatSpacing }));
  expect(state.ahead).toBe(24.75); expect(state.far).toBeGreaterThan(state.ahead * state.spacing);
  const toggle = await page.locator('#toggle-timeline').boundingBox(), transport = await page.locator('.transport').boundingBox();
  expect(toggle!.y + toggle!.height).toBeLessThan(transport!.y);
  expect(toggle!.x + toggle!.width / 2).toBeCloseTo(transport!.x + transport!.width / 2, 0);
  await page.screenshot({ path: 'test-results/scene-controls-timeline.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  const range = await page.locator('#preview-range').boundingBox(), scene = await page.locator('#preview').boundingBox();
  expect(range!.y + range!.height).toBeLessThan(scene!.y + scene!.height);
  await page.locator('#preview-range').click(); await expect(page.locator('#preview')).toBeFocused();
  await page.locator('#division').selectOption('24'); await expect(page.locator('#division')).toHaveValue('24');
  await page.screenshot({ path: 'test-results/scene-controls-720.png' });
});

test('continuous speed preserves playback position and metronome gain is independent of song volume', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio { constructor(...args: ConstructorParameters<typeof Audio>) { super(...args); (window as any).testSongAudio = this; } };
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function() {
      const node = original.call(this), set = node.gain.setValueAtTime.bind(node.gain);
      node.gain.setValueAtTime = (value, time) => { (window as any).testClickGain = value; return set(value, time); };
      return node;
    };
  });
  await fresh(page); await expect(page.locator('#speed')).toHaveAttribute('type', 'range');
  await slider(page, 'speed', .73); await expect(page.locator('#speed-value')).toHaveText('0.73×');
  expect(await page.evaluate(() => (window as any).testSongAudio.playbackRate)).toBeCloseTo(.73);
  await page.locator('#play').click(); await page.waitForTimeout(250);
  const before = Number(await page.locator('#beat-input').inputValue()); await slider(page, 'speed', 1.37);
  const after = Number(await page.locator('#beat-input').inputValue()); expect(after).toBeGreaterThanOrEqual(before); expect(after - before).toBeLessThan(.3);
  await page.waitForTimeout(200); expect(Number(await page.locator('#beat-input').inputValue())).toBeGreaterThan(after + .35);
  await page.keyboard.press('Space'); await expect(page.locator('#play .lucide-play')).toBeVisible();
  await slider(page, 'volume', 0); await slider(page, 'metronome-volume', .8); await page.locator('#metronome').click();
  expect(await page.evaluate(() => (window as any).testClickGain)).toBeCloseTo(.384);
  expect(await page.evaluate(() => (window as any).testSongAudio.volume)).toBe(0);
  await page.locator('#metronome').click(); await slider(page, 'metronome-volume', 0); await page.locator('#metronome').click();
  expect(await page.evaluate(() => (window as any).testClickGain)).toBe(0);
  await page.screenshot({ path: 'test-results/scene-controls.png' });
});
