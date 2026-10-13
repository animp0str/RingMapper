import { test, expect, type Page } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { selectLastVisibleNote, unitDepth, frontCamera } from './helpers';
async function fresh(page: Page) { await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await page.locator('#new-project').click(); await page.locator('#apply-settings').click(); await unitDepth(page); await frontCamera(page); }
async function beat(page: Page, n: number) { await page.locator('#beat-input').fill(String(n)); await page.keyboard.press('Enter'); }
async function field(page: Page, key: string, n: string) { await page.locator(`[data-field="${key}"]`).fill(n); await page.locator(`[data-field="${key}"]`).dispatchEvent('change'); }
async function exported(page: Page) { const pending = page.waitForEvent('download'); await page.locator('#export').click(); const download = await pending; const zip = await JSZip.loadAsync(await fs.readFile((await download.path())!)); return parse(await zip.file('Ring/NormalRing.yaml')!.async('string')); }

test('empty difficulties create the exact mode and rank; folder button selects a local workspace', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#workspace-folder').click(); await expect(page.locator('#workspace-name')).toHaveText('Map');
  await expect(page.locator('#mode-name, #add-difficulty')).toHaveCount(0);
  for (const mode of ['Ring', 'RingDance']) await expect(page.locator(`[data-difficulty-mode="${mode}"] .difficulty`)).toHaveCount(5);
  const empty = page.locator('[data-create-mode="RingDance"][data-create-difficulty="Expert"]');
  await expect(empty).toHaveClass(/difficulty-empty/); await empty.click();
  await expect(page.locator('#new-mode')).toHaveValue('RingDance'); await expect(page.locator('#new-difficulty')).toHaveValue('Expert');
  await page.locator('#difficulty-create').click(); await expect(page.locator('#source-path')).toHaveText('RingDance/ExpertRingDance.yaml');
  await expect(empty).toHaveCount(0); await expect(page.locator('[data-chart="RingDance/ExpertRingDance.yaml"]')).toHaveClass(/active/);
  await page.locator('[data-chart="Ring/NormalRing.yaml"]').click(); await expect(page.locator('#source-path')).toHaveText('Ring/NormalRing.yaml');
  await page.locator('#new-project').click(); await page.locator('#discard').click(); await page.locator('#apply-settings').click();
  await page.locator('#workspace-folder').click(); await expect(page.locator('#workspace-name')).toHaveText('Map');
});

test('illustrated tutorial covers all chapters without branded wording and keeps actions accessible at 720p', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  const forbidden = /\u95ea\u97f5\u7075\u5883|ciph\u0065r/i;
  expect(await page.locator('body').innerText()).not.toMatch(forbidden);
  await expect(page.locator('#tutorial span')).toBeVisible();
  const tutorial = (await page.locator('#tutorial').boundingBox())!, help = (await page.locator('#help').boundingBox())!;
  expect(tutorial.x + tutorial.width).toBeLessThan(help.x);
  await page.locator('#tutorial').click(); await expect(page.locator('.tutorial-layout nav button')).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    await page.locator(`.tutorial-layout nav [data-tutorial-step="${i}"]`).click();
    await expect(page.locator('.tutorial-article h3')).toContainText(`${i + 1}.`);
    await expect.poll(() => page.locator('.tutorial-article img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.locator('#modal').innerText()).not.toMatch(forbidden);
  }
  await page.locator('.tutorial-layout nav [data-tutorial-step="4"]').click(); await page.screenshot({ path: 'test-results/tutorial-fill-720.png' });
  await page.locator('#close-modal').click(); await expect(page.locator('#preview')).toBeFocused();
  await expect(page.locator('#toggle-timeline')).toContainText('传统时间轴'); await page.locator('#toggle-timeline').click(); await expect(page.locator('#toggle-timeline')).toContainText('传统时间轴');
  await page.screenshot({ path: 'test-results/difficulties-tutorial-720.png' });
});

test('note opacity can be linked or independent, includes hold tails, and survives reload without changing note data', async ({ page }) => {
  await fresh(page); await page.locator('#add-at-beat').click(); await page.locator('#hold-add').click();
  const before = await exported(page);
  const opacity = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => Object.fromEntries(['hand-notes', 'foot-notes', 'foot-holds'].map(name => {
    const m = (el.spatialPreview!.scene.getObjectByName(name) as import('three').Mesh).material as import('three').Material;
    return [name, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite }];
  })));
  await page.locator('#view-settings').click(); await page.locator('#hand-opacity').fill('40'); await page.locator('#hand-opacity').dispatchEvent('input');
  await expect(page.locator('#foot-opacity')).toHaveValue('40'); expect((await opacity())['foot-holds'].opacity).toBeCloseTo(.2);
  await page.locator('#note-opacity-linked').uncheck(); await page.locator('#foot-opacity').fill('75'); await page.locator('#foot-opacity').dispatchEvent('input');
  expect(await opacity()).toMatchObject({ 'hand-notes': { opacity: .4, transparent: true, depthWrite: false }, 'foot-notes': { opacity: .75 }, 'foot-holds': { opacity: .375 } });
  await page.locator('#hand-opacity').fill('0'); await page.locator('#hand-opacity').dispatchEvent('input'); await page.locator('#view-apply').click();
  await selectLastVisibleNote(page); await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  expect(await exported(page)).toEqual(before);
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#view-settings').click(); await expect(page.locator('#hand-opacity')).toHaveValue('0'); await expect(page.locator('#foot-opacity')).toHaveValue('75'); await expect(page.locator('#note-opacity-linked')).not.toBeChecked();
  await page.locator('#note-opacity-linked').check(); await expect(page.locator('#foot-opacity')).toHaveValue('0');
});

test('notes mode selects a future wall without placing a hand and stays in notes mode', async ({ page }) => {
  await fresh(page); await page.keyboard.press('2'); await beat(page, 2); await page.locator('#add-at-beat').click(); await beat(page, 0); await page.keyboard.press('1');
  const point = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, mesh = p.scene.getObjectByName('obstacles') as import('three').InstancedMesh;
    const pos = mesh.userData.batch.records[0].position, hit = p.screenPosition(pos), b = el.getBoundingClientRect();
    return { x: b.x + hit.x, y: b.y + hit.y };
  });
  await page.mouse.click(point.x, point.y); await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  await expect(page.locator('[data-field="time"]')).toHaveValue('2'); await expect(page.locator('[data-mode="notes"]')).toHaveClass('active');
  await expect(page.locator('#note-count')).toHaveText('0'); await expect(page.locator('#mirror-up-down')).toBeDisabled();
  await page.keyboard.press('Delete');
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => (el.spatialPreview!.scene.getObjectByName('obstacles') as import('three').InstancedMesh).count)).toBe(0);
});

test('quick fill sits beside grouping; cancel restores endpoint metadata and the original undo history', async ({ page }) => {
  await fresh(page); await expect(page.locator('#quick-fill')).toBeHidden();
  await page.locator('#add-at-beat').click(); await beat(page, 1); await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await field(page, 'lineIndex', '2'); await field(page, 'lineLayer', '2'); await beat(page, 0); await page.keyboard.press('Control+a');
  await page.locator('#quick-group').click(); const before = await exported(page);
  const group = (await page.locator('#quick-group').boundingBox())!, fill = (await page.locator('#quick-fill').boundingBox())!;
  expect(fill.x).toBeGreaterThan(group.x + group.width); expect(fill.y).toBeCloseTo(group.y, 0);
  await page.locator('#quick-fill').click(); await page.locator('#fill-more').click(); await page.locator('#fill-counterclockwise').click();
  expect(Number(await page.locator('#note-count').innerText())).toBeGreaterThan(2);
  await page.locator('#fill-cancel').click(); await expect(page.locator('#fill-panel')).toBeHidden(); await expect(page.locator('#note-count')).toHaveText('2');
  expect(await exported(page)).toEqual(before);
  await page.keyboard.press('Control+z'); const undone = await exported(page); expect(undone.notes.every((n: any) => !n.groupId)).toBe(true);
  await page.keyboard.press('Control+y'); expect(await exported(page)).toEqual(before);
});
