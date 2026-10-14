import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { newProject, writeYaml } from '../../src/model';
async function song(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  const p = newProject(); p.info.songName = 'Feedback fixture'; p.chart.notes = [{ time: 1, lineIndex: 0, lineLayer: 0, type: 0 }]; p.chart.ringNotes = [{ time: 1, lineIndex: 0, ringNoteType: 0, type: 0 }, { time: 1, lineIndex: 35, ringNoteType: 1, duration: 1, type: 1 }];
  const zip = new JSZip().file('Info.yaml', writeYaml(p.info)).file(p.chartPath, writeYaml(p.chart)).file(p.eventPath, writeYaml(p.event));
  await page.locator('#import-input').setInputFiles({ name: 'fixture.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#song-name')).toHaveText('Feedback fixture');
}
async function seek(page: Page, beat: number) { await page.locator('#beat-input').fill(String(beat)); await page.keyboard.press('Enter'); }
test('passed note retention defaults on at five percent, fades hand/foot/hold geometry and persists independently of the chart', async ({ page }) => {
  await song(page); await seek(page, 2.01);
  const geometry = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => ['passed-hand-notes', 'passed-foot-notes', 'passed-foot-holds'].map(name => { const m = el.spatialPreview!.scene.getObjectByName(name) as import('three').InstancedMesh; return { count: m.count, opacity: (m.material as import('three').Material).opacity }; }));
  expect(await geometry()).toEqual([{ count: 1, opacity: .05 }, { count: 2, opacity: .05 }, { count: 1, opacity: .025 }]);
  await page.locator('#view-settings').click(); await expect(page.locator('#retain-passed')).toBeChecked(); await expect(page.locator('#passed-opacity')).toHaveValue('5');
  await expect(page.locator('#hand-opacity')).toHaveValue('100'); await expect(page.locator('#foot-opacity')).toHaveValue('100');
  await page.locator('#passed-opacity').fill('35'); await page.locator('#passed-opacity').dispatchEvent('input'); expect((await geometry())[0].opacity).toBe(.35);
  await page.locator('#note-opacity-linked').uncheck(); await page.locator('#foot-opacity').fill('90'); await page.locator('#foot-opacity').dispatchEvent('input');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.scene.children.filter(o => o.name === 'foot-track-label').slice(0, 2).map(o => ((o as import('three').Mesh).material as import('three').Material).opacity))).toEqual([.35, .35]);
  await page.locator('#retain-passed').uncheck(); expect((await geometry()).map(m => m.count)).toEqual([0, 0, 0]);
  await page.locator('#retain-passed').check(); await page.locator('#view-apply').click(); await seek(page, 0);
  expect((await geometry()).map(m => m.count)).toEqual([0, 0, 0]);
  await page.reload();
  await expect.poll(async () => await page.locator('#restore-draft').isVisible() || await page.locator('#song-name').textContent() === 'Diabolic Swing').toBe(true);
  if (await page.locator('#restore-draft').isVisible()) await page.locator('#skip-draft').click();
  await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await page.locator('#view-settings').click(); await expect(page.locator('#retain-passed')).toBeChecked(); await expect(page.locator('#passed-opacity')).toHaveValue('35');
});
test('note sound settings are independent, playback emits clicks, paused seeking emits none', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__noteClicks = [];
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = original.call(this), set = node.frequency.setValueAtTime.bind(node.frequency), start = node.start.bind(node); let frequency = 0;
      node.frequency.setValueAtTime = (value, at) => { frequency = value; return set(value, at); };
      node.start = (at) => { (window as any).__noteClicks.push({ frequency, at }); start(at); }; return node;
    };
  });
  await song(page); const volume = await page.locator('#volume').inputValue(), metronome = await page.locator('#metronome-volume').inputValue();
  await page.locator('#view-settings').click(); await expect(page.locator('#note-hit-sound')).not.toBeChecked();
  await page.locator('#note-hit-sound').check(); await page.locator('#note-hit-volume').fill('0.25'); await page.locator('#note-hit-volume').dispatchEvent('input'); await page.locator('#view-apply').click();
  await seek(page, .9); expect(await page.evaluate(() => (window as any).__noteClicks.length)).toBe(0);
  await page.locator('#play').click(); await expect.poll(() => page.evaluate(() => (window as any).__noteClicks.length)).toBeGreaterThanOrEqual(2); await page.locator('#play').click();
  const sounds = await page.evaluate(() => (window as any).__noteClicks); expect(sounds.map((s: any) => s.frequency)).toContain(1800); expect(sounds.map((s: any) => s.frequency)).toContain(480);
  await seek(page, 0); await seek(page, 2); expect(await page.evaluate(() => (window as any).__noteClicks.length)).toBe(sounds.length);
  await expect(page.locator('#volume')).toHaveValue(volume); await expect(page.locator('#metronome-volume')).toHaveValue(metronome);
});
test('offset UI uses milliseconds but exported data remains seconds; deprecated labels are absent', async ({ page }) => {
  await song(page); await expect(page.locator('#source-path, .preview-beat, .library-bottom')).toHaveCount(0); await expect(page.locator('#inspector')).not.toContainText('当前节拍');
  await page.locator('#settings').click(); await expect(page.locator('#modal')).toContainText('手部音符飞行速度'); await expect(page.locator('#modal')).toContainText('脚部出生位置偏移'); await expect(page.locator('#modal')).toContainText('音频偏移（ms）');
  await page.locator('[data-info="songTimeOffset"]').fill('1250'); await page.locator('#apply-settings').click();
  await page.locator('#settings').click(); await expect(page.locator('[data-info="songTimeOffset"]')).toHaveValue('1250'); await page.locator('#close-modal').click();
  const pending = page.waitForEvent('download'); await page.locator('#export').click(); const zip = await JSZip.loadAsync(await fs.readFile((await (await pending).path())!));
  expect(parse(await zip.file('Info.yaml')!.async('string')).songTimeOffset).toBe(1.25);
});

test('changelog supports long editable title/body entries and feedback has the exact external destination', async ({ page }) => {
  await page.route('**/changelog.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ title: 'Version test', body: Array.from({ length: 80 }, (_, i) => `${i} <b>plain text</b>\nLong update text`) }]) }));
  await page.goto('/'); await page.locator('#changelog').click(); await expect(page.locator('.changelog-content li')).toHaveCount(80); await expect(page.locator('.changelog-content h3')).toHaveText('Version test'); await expect(page.locator('.changelog-content b')).toHaveCount(0);
  expect(await page.locator('#modal').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('#close-modal').click(); await expect(page.locator('#feedback')).toHaveAttribute('href', 'https://my.feishu.cn/share/base/form/shrcncsSX6mrqN9yP9WWvPDKK7c'); await expect(page.locator('#feedback')).toHaveAttribute('target', '_blank');
});
for (const [width, height] of [[2560, 1440], [1920, 1080], [1219, 687], [1024, 600], [800, 600], [640, 480]]) test(`responsive controls stay reachable at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height }); await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await page.locator('#view-settings').click(); await page.locator('#view-apply').click();
  await expect.poll(() => page.locator('#scene-workspace').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const selector of ['.scene-top', '.scene-camera', '#tools-panel', '.transport', '#toggle-timeline']) {
    const b = await page.locator(selector).boundingBox(); expect(b, selector).not.toBeNull(); expect(b!.x, selector).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width, selector).toBeLessThanOrEqual(width + 1); expect(b!.y + b!.height, selector).toBeLessThanOrEqual(height);
  }
  const controls = await page.locator('.scene-camera').boundingBox(), top = await page.locator('.scene-top').boundingBox(), transport = await page.locator('.transport').boundingBox(), tools = await page.locator('#tools-panel').boundingBox();
  expect(controls!.y).toBeGreaterThanOrEqual(top!.y + top!.height); expect(tools!.y + tools!.height).toBeLessThan(transport!.y);
  await seek(page, 24); await page.screenshot({ path: `test-results/responsive-${width}x${height}.png` });
  await page.locator('#toggle-timeline').click(); await expect(page.locator('#timeline-panel')).toBeVisible(); await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished))); 
  const timeline = await page.locator('#timeline-panel').boundingBox(); expect(timeline!.y + timeline!.height).toBeLessThan(transport!.y);
});
