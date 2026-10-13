import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { parse } from 'yaml';
import { createHash } from 'node:crypto';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('built-in song is playable, remains in the library and exports all original media with edits', async ({ page }) => {
  await page.addInitScript(() => { const AudioClass = window.Audio; (window as any).Audio = function () { const a = new AudioClass(); (window as any).__songAudio = a; return a; }; });
  const uploads: string[] = []; page.on('request', r => { if (r.method() !== 'GET') uploads.push(r.url()); });
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await expect(page.locator('#open-example')).toBeVisible(); await expect(page.locator('#note-count')).toHaveText('2597');
  await expect(page.locator('[data-chart="Ring/ExpertRing.yaml"]')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => (window as any).__songAudio.duration)).toBeGreaterThan(150);
  await page.locator('#play').click(); await expect.poll(() => page.evaluate(() => (window as any).__songAudio.currentTime)).toBeGreaterThan(0); await page.locator('#play').click();
  await page.keyboard.press('Control+b'); await expect(page.locator('#save-state')).toHaveText('有未保存修改');
  const pending = page.waitForEvent('download'); await page.locator('#export').click(); const download = await pending;
  const exported = await JSZip.loadAsync(await fs.readFile((await download.path())!));
  const original = await JSZip.loadAsync(await fs.readFile('public/examples/diabolic-swing/song.zip'));
  for (const name of ['song.ogg', 'cover.png']) expect(digest(await exported.file(name)!.async('nodebuffer'))).toEqual(digest(await original.file('Diabolic_Swing_2023_06_27_16_00_22/' + name)!.async('nodebuffer')));
  expect(parse(await exported.file('Ring/ExpertRing.yaml')!.async('string')).customData.bookmarks.length).toBeGreaterThan(0);
  expect(uploads).toEqual([]);
  await page.locator('#new-project').click(); await page.locator('#discard').click(); await page.locator('#apply-settings').click();
  await expect(page.locator('#open-example')).toBeVisible(); await page.locator('#open-example').click(); await page.locator('#discard').click();
  await expect(page.locator('#note-count')).toHaveText('2597'); await expect(page.locator('#save-state')).toHaveText('示例 · 未修改');
});

for (const version of [4, 5]) test(`RAR${version} imports through both selectors and exports a valid song`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await page.locator(version === 4 ? '#audio-input' : '#import-input').setInputFiles(`tests/fixtures/song-rar${version}.rar`);
  await expect(page.locator('#song-name')).toHaveText('RAR Test'); await expect(page.locator('#note-count')).toHaveText('1');
  const pending = page.waitForEvent('download'); await page.locator('#export').click(); const download = await pending;
  const zip = await JSZip.loadAsync(await fs.readFile((await download.path())!));
  expect(parse(await zip.file('NormalRing.yaml')!.async('string')).notes).toHaveLength(1);
  await page.locator('#import-input').setInputFiles({ name: 'broken.RAR', mimeType: 'application/vnd.rar', buffer: Buffer.from('not an archive') });
  await expect(page.locator('#toast')).toContainText('导入失败'); await expect(page.locator('#song-name')).toHaveText('RAR Test'); expect(errors).toEqual([]);
});

test('example saves a complete editable copy into an empty local workspace and remains available afterward', async ({ page }) => {
  await page.addInitScript(() => { (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('example-copy', { create: true }); });
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await page.locator('#save').click(); await page.locator('#save-pick-folder').click(); await expect(page.locator('#workspace-name')).toHaveText('example-copy');
  await page.locator('#save').click(); await page.locator('#new-song-id').fill('diabolic-copy'); await page.locator('#confirm-save').click(); await expect(page.locator('#save-state')).toHaveText('已保存');
  const files = await page.evaluate(async () => {
    const song = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('example-copy')).getDirectoryHandle('diabolic-copy');
    return { info: await (await song.getFileHandle('Info.yaml')).getFile().then(f => f.text()), audioSize: (await (await song.getFileHandle('song.ogg')).getFile()).size, chartSize: (await (await (await song.getDirectoryHandle('Ring')).getFileHandle('ExpertRing.yaml')).getFile()).size };
  });
  expect(parse(files.info).songName).toBe('Diabolic Swing'); expect(files.audioSize).toBe(9219718); expect(files.chartSize).toBeGreaterThan(100000);
  await expect(page.locator('#open-example')).toBeVisible(); await page.reload(); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing'); await expect(page.locator('#save-state')).toHaveText('已保存');
});
