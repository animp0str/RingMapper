import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { selectLastVisibleNote, unitDepth, frontCamera } from './helpers';

test('library, editing, undo, multi-selection, group, export and playback', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await expect(page.locator('#song-count')).toHaveText(/\d+ 首/);
  await page.locator('#search').fill('3n3rgizer'); await expect(page.locator('.song-card')).toHaveCount(1); await page.locator('#search').fill('');
  await page.locator('#beat-input').fill('8'); await page.locator('#beat-input').dispatchEvent('change');
  await page.locator('[data-mode="notes"]').click(); await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="time"]')).toHaveValue('8');
  await page.locator('[data-field="lineIndex"]').fill('1'); await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
  await page.locator('#copy').click(); await page.locator('#beat-input').fill('9'); await page.locator('#beat-input').dispatchEvent('change'); await page.locator('#paste').click();
  await expect(page.locator('[data-field="time"]')).toHaveValue('9');
  await page.locator('#mirror-left-right').click(); await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('2');
  await page.locator('#undo').click(); await page.locator('#redo').click();
  await page.locator('#range-select').click(); await page.locator('#range-start').fill('8'); await page.locator('#range-end').fill('9'); await page.locator('#range-kind').selectOption('notes'); await page.locator('#range-apply').click();
  await expect(page.locator('#selection-count')).not.toHaveText('未选中');
  await page.locator('#check').click(); await expect(page.locator('#modal')).toBeVisible(); await expect(page.locator('#modal-content')).toContainText('手部音符'); await page.locator('#close-modal').click();
  await page.locator('#play').click(); await page.waitForTimeout(600);
  const beforeSeek = Number(await page.locator('#beat-input').inputValue());
  await page.locator('#preview').hover({ position: { x: 400, y: 400 } }); await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(await page.locator('#beat-input').inputValue())).toBeGreaterThan(beforeSeek + .9);
  await page.waitForTimeout(150); await page.locator('#play').click();
  expect(Number(await page.locator('#beat-input').inputValue())).toBeGreaterThan(beforeSeek + .9); expect(Number(await page.locator('#beat-input').inputValue())).toBeGreaterThan(9);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise; const file = await download.path();
  const zip = await JSZip.loadAsync(await fs.readFile(file!)); const info = parse(await zip.file('Info.yaml')!.async('string')); expect(info.songName).toBe('曹操');
  expect(zip.file('caocao.ogg')).not.toBeNull(); expect(zip.file('Ring/NormalRing.yaml')).not.toBeNull();
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true }); expect(errors).toEqual([]);
});

test('new project, hold, custom audio, save, backups and stale revision protection', async ({ page, request }) => {
  const id = `ringmapper-test-${Date.now()}`, root = path.resolve('Map', id), backups = path.resolve('.ringmapper-backups', id);
  try {
    await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
    await page.locator('#new-project').click(); await page.locator('[data-info="songName"]').fill('测试谱面');
    await page.locator('#audio-input').setInputFiles(path.resolve('Map/caocao/caocao.ogg'));
    await expect(page.locator('#toast')).toContainText('音频');
    await page.locator('#apply-settings').click(); await page.locator('[data-mode="notes"]').click(); await page.locator('#hold-add').click(); await selectLastVisibleNote(page, 'ringNotes'); await expect(page.locator('[data-field="ringNoteType"]')).toHaveValue('1');
    await page.locator('[data-field="lineIndex"]').fill('35'); await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
    await page.locator('#save').click(); await page.locator('#new-song-id').fill(id); await page.locator('#confirm-save').click();
    await expect(page.locator('#save-state')).toHaveText('已保存', { timeout: 15000 }); expect((await fs.stat(path.join(root, 'caocao.ogg'))).size).toBeGreaterThan(1000);
    const original = await (await request.get(`/api/project?song=${id}&chart=Ring/NormalRing.yaml`)).json();
    await page.locator('[data-field="duration"]').fill('4'); await page.locator('[data-field="duration"]').dispatchEvent('change'); await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('已保存', { timeout: 15000 });
    expect((await fs.readdir(backups)).length).toBeGreaterThan(0);
    const conflict = await request.post('/api/save', { data: original }); expect(conflict.status()).toBe(400); expect((await conflict.json()).error).toContain('修改');
    const chart = parse(await fs.readFile(path.join(root, 'Ring/NormalRing.yaml'), 'utf8')); expect(chart.ringNotes[0].duration).toBe(4);
    await page.locator('[data-create-mode="Ring"][data-create-difficulty="Hard"]').click(); await page.locator('#difficulty-create').click(); await expect(page.locator('#source-path')).toHaveText('Ring/HardRing.yaml'); await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('已保存', { timeout: 15000 });
    expect(await fs.stat(path.join(root, 'Ring/HardRing.yaml'))).toBeTruthy(); expect(await fs.stat(path.join(root, 'Ring/NormalRing.yaml'))).toBeTruthy();
  } finally {
    // Only the uniquely named test workspace and its matching backup are removed.
    if (root.startsWith(path.resolve('Map') + path.sep) && path.basename(root).startsWith('ringmapper-test-')) await fs.rm(root, { recursive: true, force: true });
    if (backups.startsWith(path.resolve('.ringmapper-backups') + path.sep) && path.basename(backups).startsWith('ringmapper-test-')) await fs.rm(backups, { recursive: true, force: true });
  }
});

test('ZIP import preserves additional fields and event files', async ({ page }) => {
  const zip = new JSZip(); zip.file('folder/Info.yaml', 'version: 2.3.0\nsongName: Imported\nbeatsPerMinute: 120\nsongDuration: 60\n');
  zip.file('folder/Ring/NormalRing.yaml', 'version: 2.3.0\nnotes:\n  - time: 1.125\n    lineIndex: 2\n    lineLayer: 2\n    type: 0\n    cutDirection: 8\n    customMarker: keep\nringNotes: []\nobstacles: []\n');
  zip.file('folder/Ring/HardRing.yaml', 'version: 2.3.0\nnotes: []\nringNotes: []\nobstacles: []\n');
  zip.file('folder/Ring/NormalRingEvent.yaml', 'events:\n  - time: 3\n    type: 101\n    value: 2\n');
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await page.locator('#import-input').setInputFiles({ name: 'import.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#song-name')).toHaveText('Imported'); await page.locator('#beat-input').fill('1.125'); await page.locator('#beat-input').dispatchEvent('change');
  await page.locator('[data-chart="Ring/HardRing.yaml"]').click(); await expect(page.locator('#source-path')).toHaveText('Ring/HardRing.yaml');
  await page.locator('[data-chart="Ring/NormalRing.yaml"]').click(); await expect(page.locator('#source-path')).toHaveText('Ring/NormalRing.yaml');
  const d = page.waitForEvent('download'); await page.locator('#export').click(); const download = await d; const exported = await JSZip.loadAsync(await fs.readFile((await download.path())!));
  const chart = parse(await exported.file('Ring/NormalRing.yaml')!.async('string')); expect(chart.notes[0].customMarker).toBe('keep'); expect(chart.notes[0].time).toBe(1.125);
  const event = parse(await exported.file('Ring/NormalRingEvent.yaml')!.async('string')); expect(event.events[0].type).toBe(101);
});


test('preview placement, direction drag, duration drag, box selection and grouping', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();

  await frontCamera(page);
  const preview = await page.locator('#preview').boundingBox();
  const position = await page.evaluate(async () => { const layoutPath = '/src/layout.ts'; const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; const { handWorldPosition } = await import(layoutPath); return spatialPreview.screenPosition(handWorldPosition(0, 2)); });
  await page.mouse.click(preview!.x + position.x, preview!.y + position.y); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="cutDirection"]')).toBeVisible();
  await page.locator('[data-mode="notes"]').click(); await page.locator('#add-at-beat').click();
  await page.locator('#beat-input').fill('1'); await page.locator('#beat-input').dispatchEvent('change');
  await page.locator('[data-mode="notes"]').click(); await page.locator('#add-at-beat').click();
  await page.locator('#toggle-timeline').click();
  await expect(page.locator('#timeline-panel')).not.toHaveClass(/is-collapsed/);
  // Wait for the drawer transition before using screen coordinates.
  await page.locator('#timeline-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  const handCanvas = await page.locator('#timeline').boundingBox();
  const handY = handCanvas!.y + 164.4 / 524 * handCanvas!.height;
  await page.keyboard.down('Alt'); await page.mouse.move(handCanvas!.x + 134, handY); await page.mouse.down(); await page.mouse.move(handCanvas!.x + 182, handY, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(page.locator('[data-field="cutDirection"]')).toHaveValue('3');
  await page.locator('#range-select').click(); await page.locator('#range-start').fill('0'); await page.locator('#range-end').fill('1'); await page.locator('#range-kind').selectOption('notes'); await page.locator('#range-apply').click(); await page.locator('#group').click();
  await expect(page.locator('[data-field="groupId"]')).not.toHaveValue('');
  await page.locator('[data-mode="notes"]').click(); await page.locator('#hold-add').click();

  const canvas = await page.locator('#timeline').boundingBox(); const x = canvas!.x + 86 + 48, y = canvas!.y + (205 + 84 / 72) / 524 * canvas!.height;
  await page.keyboard.down('Alt'); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 96, y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt');
  await expect(page.locator('[data-field="duration"]')).toHaveValue('3');
  await page.keyboard.down('Shift'); await page.mouse.move(canvas!.x + 87, canvas!.y + 45 / 524 * canvas!.height); await page.mouse.down(); await page.mouse.move(canvas!.x + 155, canvas!.y + 185 / 524 * canvas!.height, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
  await expect(page.locator('#selection-count')).not.toHaveText('未选中');
});
