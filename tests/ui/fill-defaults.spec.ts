import { test, expect, type Page } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { selectLastVisibleNote, frontCamera, unitDepth } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
  await unitDepth(page); await frontCamera(page);
}
async function beat(page: Page, value: number) { await page.locator('#beat-input').fill(String(value)); await page.keyboard.press('Enter'); }
async function field(page: Page, name: string, value: string) { await page.locator(`[data-field="${name}"]`).fill(value); await page.locator(`[data-field="${name}"]`).dispatchEvent('change'); }
async function exported(page: Page) {
  const pending = page.waitForEvent('download'); await page.locator('#export').click(); const download = await pending;
  const zip = await JSZip.loadAsync(await fs.readFile((await download.path())!)); return parse(await zip.file('Ring/NormalRing.yaml')!.async('string'));
}
async function endpoints(page: Page) {
  await page.locator('#add-at-beat').click(); await beat(page, 1); await page.keyboard.press('q');
  await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await field(page, 'lineIndex', '2'); await field(page, 'lineLayer', '2');
  await beat(page, 0); await page.keyboard.press('Control+a'); await expect(page.locator('#selection-count')).toHaveText('已选 2 项');
}

test('view defaults accept numbers, apply immediately, survive reload, and temporary sliders do not overwrite them', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await expect(page.locator('#depth-zoom')).toHaveValue('10'); await expect(page.locator('#preview-range')).toHaveValue('3');
  await page.locator('#view-settings').click();
  await expect(page.locator('#default-depth')).toHaveValue('10'); await expect(page.locator('#default-preview-range')).toHaveValue('3');
  await page.locator('#default-depth').fill('21'); await page.locator('#view-apply').click(); await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#previewMax').fill('16');
  await page.locator('#default-depth').fill('6.25'); await page.locator('#default-preview-range').fill('12.5'); await page.locator('#view-apply').click();
  await expect(page.locator('#depth-zoom')).toHaveValue('6.25'); await expect(page.locator('#preview-range')).toHaveValue('12.5');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => ({ depth: el.spatialPreview!.depthScale, range: el.spatialPreview!.lookAhead }))).toEqual({ depth: 6.25, range: 12.5 });
  await unitDepth(page); await page.locator('#preview-range').fill('3'); await page.locator('#preview-range').dispatchEvent('input');
  await page.locator('#view-settings').click(); await expect(page.locator('#default-depth')).toHaveValue('6.25'); await page.locator('#view-apply').click();
  await expect(page.locator('#depth-zoom')).toHaveValue('1'); // Opening settings alone preserves temporary adjustments.
  await page.reload(); await expect(page.locator('#song-name')).toHaveText('曹操');
  await expect(page.locator('#depth-zoom')).toHaveValue('6.25'); await expect(page.locator('#preview-range')).toHaveValue('12.5');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.depthScale)).toBe(6.25);
});

test('two hand endpoints fill in 3D, density replaces the previous result, directions land on target, and export/undo preserve data', async ({ page }) => {
  await fresh(page); await expect(page.locator('#fill')).toBeHidden(); await endpoints(page);
  await page.locator('#fill').click(); await expect(page.locator('#fill-panel')).toBeVisible();
  await expect(page.locator('#note-count')).toHaveText('5'); await expect(page.locator('.fill-result')).toContainText('已新增 3 个');
  await expect(page.locator('#selection-count')).toHaveText('已选 2 项'); await expect(page.locator('#division')).toHaveValue('4');
  await expect(page.locator('#fill-less')).toBeDisabled();
  await page.locator('#fill-more').click(); await expect(page.locator('#note-count')).toHaveText('15');
  await page.locator('#fill-less').click(); await expect(page.locator('#note-count')).toHaveText('5');
  await page.locator('#fill-counterclockwise').click(); await expect(page.locator('#note-count')).toHaveText('7');
  await expect(page.locator('#overlap-status')).toBeHidden();
  const chart = await exported(page), sorted = chart.notes.sort((a: any, b: any) => a.time - b.time);
  expect(sorted[0]).toMatchObject({ time: 0, lineIndex: 0, lineLayer: 0, type: 0 });
  expect(sorted.at(-1)).toMatchObject({ time: 1, lineIndex: 2, lineLayer: 2, type: 1 });
  expect(sorted.slice(1, -1).every((n: any) => n.type === 0)).toBe(true);
  const lanes = [[0,2],[1,2],[2,2],[3,2],[3,1],[3,0],[2,0],[1,0],[0,0],[0,1]];
  expect(sorted.map((n: any) => lanes.findIndex(([x,y]) => x === n.lineIndex && y === n.lineLayer))).toEqual([8,7,6,5,4,3,2]);
  for (let i = 0; i < sorted.length; i++) expect(sorted[i].time).toBeCloseTo(i / 6, 10);
  await page.screenshot({ path: 'test-results/ring-fill.png' });
  await page.keyboard.press('Control+z'); await expect(page.locator('#note-count')).toHaveText('5'); await expect(page.locator('#fill-panel')).toBeHidden();
  await page.keyboard.press('Control+y'); await expect(page.locator('#note-count')).toHaveText('7');
});

test('fill preserves an existing note on the path, rejects equal-beat pairs, and closes on another edit', async ({ page }) => {
  await fresh(page); await endpoints(page);
  await page.locator('#group').click(); // Fill also works for two grouped endpoints.
  await page.locator('#fill').click(); await page.locator('#fill-close').click();
  await page.locator('#fill').click(); await expect(page.locator('.fill-result')).toContainText('已新增 0 个 · 保留已有 3 个');
  await expect(page.locator('#note-count')).toHaveText('5'); await page.locator('#fill-more').click();
  await expect(page.locator('#overlap-status')).toBeHidden();
  const notes = (await exported(page)).notes;
  expect(new Set(notes.map((n: any) => n.groupId)).size).toBe(1);
  expect(notes.filter((n: any) => n.groupNoteType === 1)).toHaveLength(1); expect(notes.filter((n: any) => n.groupNoteType === 2)).toHaveLength(1);
  await page.locator('#mirror-left-right').click(); await expect(page.locator('#fill-panel')).toBeHidden();
  await field(page, 'time', '2'); await page.locator('#fill').click();
  await expect(page.locator('#fill-panel')).toBeHidden(); await expect(page.locator('#toast')).toContainText('不同节拍');
  await page.keyboard.press('Escape'); await expect(page.locator('#fill')).toBeHidden();
});
