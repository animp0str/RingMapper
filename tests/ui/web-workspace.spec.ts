import { test as emptyTest } from '@playwright/test';
import { test, expect, fixtureFile } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { parse } from 'yaml';

emptyTest('static first visit and unsupported browser can import, edit and export ZIP without any API or upload', async ({ page }) => {
  const network: string[] = [], errors: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/') || r.method() !== 'GET') network.push(r.method() + ' ' + r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { (window as any).showDirectoryPicker = undefined; });
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing'); await expect(page.locator('.empty-library')).toContainText('打开本地 Map');
  await expect(page.locator('#workspace-name')).toHaveText('尚未选择目录');
  await page.locator('#workspace-folder').click(); await expect(page.locator('#toast')).toContainText('不支持');
  const zip = new JSZip();
  zip.file('Info.yaml', 'songName: Browser only\nbeatsPerMinute: 120\nsongTimeOffset: 0\ndifficultyBeatmapSets:\n  - beatmapCharacteristicName: Ring\n    difficultyBeatmaps:\n      - difficulty: Normal\n        beatmapFilename: Ring/NormalRing.yaml\n        eventmapFilename: Lights/custom.yaml\n');
  zip.file('Ring/NormalRing.yaml', 'notes: []\nringNotes: []\nobstacles: []\ncustomField: keep\n'); zip.file('Lights/custom.yaml', 'events:\n  - time: 1\n    type: 101\n    value: 2\n');
  zip.file('song.ogg', 'local test asset');
  await page.locator('#import-input').setInputFiles({ name: 'local.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#song-name')).toHaveText('Browser only'); await page.locator('#add-at-beat').click();
  await page.locator('#save').click(); await expect(page.locator('#modal')).toContainText('授权本地');
  const pending = page.waitForEvent('download'); await page.locator('#save-export').click(); const download = await pending;
  const output = await JSZip.loadAsync(await fs.readFile((await download.path())!));
  expect(parse(await output.file('Ring/NormalRing.yaml')!.async('string')).notes).toHaveLength(1);
  expect(parse(await output.file('Lights/custom.yaml')!.async('string')).events[0].type).toBe(101);
  expect(output.file('song.ogg')).not.toBeNull(); expect(network).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/web-zip-workspace.png', fullPage: true });
});

test('cancelled directory selection preserves edits; revoked permission can be requested again', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.evaluate(() => { (window as any).showDirectoryPicker = async () => { throw new DOMException('cancelled', 'AbortError'); }; });
  await page.locator('#workspace-folder').click(); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.addInitScript(() => {
    (FileSystemHandle.prototype as any).queryPermission = async () => 'prompt';
    (FileSystemHandle.prototype as any).requestPermission = async () => 'denied';
  });
  await page.reload(); await expect(page.locator('#workspace-authorize')).toBeVisible(); await expect(page.locator('.song-card[data-song]')).toHaveCount(0);
  await page.locator('#workspace-authorize').click(); await expect(page.locator('#toast')).toContainText('未获得读取权限');
  await page.evaluate(() => { (FileSystemHandle.prototype as any).requestPermission = async () => 'granted'; });
  await page.locator('#workspace-authorize').click(); await expect(page.locator('.song-card[data-song]')).toHaveCount(2);
  await expect(page.locator('#workspace-authorize')).toBeHidden();
});

test('draft keeps staged difficulties and imported media; workspace mismatch cannot overwrite a same-name song', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('[data-info="songName"]').fill('Draft isolation'); await page.locator('#audio-input').setInputFiles('Map/caocao/caocao.ogg'); await expect(page.locator('#toast')).toContainText('音频'); await page.locator('#apply-settings').click();
  await page.locator('#add-at-beat').click();
  await page.locator('[data-create-mode="Ring"][data-create-difficulty="Hard"]').click(); await page.locator('#difficulty-create').click();
  await page.locator('#add-at-beat').click();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ringmapper-local'); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('draft'); r.onsuccess = () => resolve(r.result); }); db.close();
    return value?.project?.chartPath;
  })).toBe('Ring/HardRing.yaml');
  page.once('dialog', dialog => dialog.accept()); await page.reload(); await page.locator('#restore-draft').click();
  await expect(page.locator('#song-name')).toHaveText('Draft isolation');
  await page.locator('[data-chart="Ring/NormalRing.yaml"]').click(); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#save').click(); await page.locator('#new-song-id').fill('draft-test'); await page.locator('#confirm-save').click(); await expect(page.locator('#save-state')).toHaveText('已保存');
  expect(parse(await fixtureFile(page, 'draft-test/Ring/HardRing.yaml')).notes).toHaveLength(1);
  expect((await fixtureFile(page, 'draft-test/caocao.ogg')).length).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ringmapper-local'); r.onsuccess = () => resolve(r.result); });
    const draft = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('draft'); r.onsuccess = () => resolve(r.result); }); db.close(); return draft?.project?.songId;
  })).toBe('draft-test');
  // Persist a recovered draft belonging to another workspace, with an identical song directory name.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ringmapper-local'); r.onsuccess = () => resolve(r.result); });
    const draft = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('draft'); r.onsuccess = () => resolve(r.result); });
    draft.project.workspaceId = 'different-directory';
    await new Promise<void>(resolve => { const tx = db.transaction('state','readwrite'); tx.objectStore('state').put(draft,'draft'); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await page.locator('#restore-draft').click(); await page.locator('#save').click(); await expect(page.locator('#toast')).toContainText('另一个工作区');
  await page.locator('#export').click(); await expect(page.locator('#modal')).toContainText('原曲库尚未授权');
});

test('static local folder save and export use blob resources and never request a backend', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('response', r => { if (r.status() >= 400) unexpected.push(`${r.status()} ${r.url()}`); });
  page.on('request', r => { if (r.url().includes('/api/') || r.method() !== 'GET') unexpected.push(r.url()); });
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await expect.poll(() => page.locator('#current-cover img').getAttribute('src')).toMatch(/^blob:/);
  await page.locator('#beat-input').fill('2'); await page.locator('#beat-input').dispatchEvent('change'); await page.locator('#add-at-beat').click();
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('已保存');
  const chart = parse(await fixtureFile(page, 'caocao/Ring/NormalRing.yaml')); expect(chart.notes.some((n: any) => n.time === 2)).toBe(true);
  const pending = page.waitForEvent('download'); await page.locator('#export').click(); const output = await JSZip.loadAsync(await fs.readFile((await (await pending).path())!));
  expect(output.file('caocao.ogg')).not.toBeNull(); expect(output.file('RingDance/HardRingDance.yaml')).not.toBeNull();
  expect(Object.keys(output.files).some(name => name.includes('.ringmapper-backups'))).toBe(false); expect(unexpected).toEqual([]);
});

test('empty folders, refresh and switching back preserve folder identity; cancelled switch retains edits', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#workspace-folder').click(); await expect(page.locator('#workspace-name')).toHaveText('Map');
  await page.evaluate(() => { (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('EmptyMap', { create: true }); });
  await page.locator('#workspace-folder').click(); await expect(page.locator('#workspace-name')).toHaveText('EmptyMap'); await expect(page.locator('.song-card[data-song]')).toHaveCount(0);
  await page.locator('#workspace-refresh').click(); await expect(page.locator('#toast')).toContainText('已刷新');
  await page.evaluate(() => { (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Map'); });
  await page.locator('#workspace-folder').click(); await expect(page.locator('#song-name')).toHaveText('曹操');
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ringmapper-local'); r.onsuccess = () => resolve(r.result); });
    const value = await new Promise<any>(resolve => { const r = db.transaction('state').objectStore('state').get('workspace'); r.onsuccess = () => resolve(r.result); }); db.close(); return value.id;
  })).toBe('fixture-map');
  const before = Number(await page.locator('#note-count').innerText()); await page.locator('#add-at-beat').click();
  await page.evaluate(() => { (window as any).showDirectoryPicker = async () => { throw new DOMException('cancelled','AbortError'); }; });
  await page.locator('#workspace-folder').click(); await page.locator('#discard').click();
  await expect(page.locator('#note-count')).toHaveText(String(before + 1)); await expect(page.locator('#save-state')).toHaveText('有未保存修改');
});
