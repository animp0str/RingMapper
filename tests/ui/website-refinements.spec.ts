import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { newProject, writeYaml } from '../../src/model';

async function localSong(page: Page) {
  const p = newProject(); p.info.songName = 'Regression song';
  const entries = p.info.difficultyCiphermapSets[0].difficultyCiphermaps;
  entries.push({ ...entries[0], difficulty: 'Hard', ciphermapFilename: 'Ring/HardRing.yaml', eventmapFilename: 'Ring/HardRingEvent.yaml' });
  const files = { 'Info.yaml': writeYaml(p.info), 'Ring/NormalRing.yaml': writeYaml(p.chart), 'Ring/NormalRingEvent.yaml': writeYaml(p.event), 'Ring/HardRing.yaml': writeYaml(p.chart), 'Ring/HardRingEvent.yaml': writeYaml(p.event) };
  await page.route('**/__setup__', route => route.fulfill({ contentType: 'text/html', body: '<title>Test workspace</title>' }));
  await page.goto('/__setup__');
  await page.evaluate(async files => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('isolated-map', { create: true });
    const song = await root.getDirectoryHandle('song', { create: true });
    for (const [name, value] of Object.entries(files)) {
      const parts = name.split('/'), filename = parts.pop()!; let dir = song;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writer = await (await dir.getFileHandle(filename, { create: true })).createWritable(); await writer.write(value); await writer.close();
    }
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ringmapper-local', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const t = db.transaction('state', 'readwrite'); t.objectStore('state').put({ id: 'regression-workspace', handle: root }, 'workspace'); t.oncomplete = () => resolve(); }); db.close();
  }, files);
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Regression song');
}

test('tutorial attention is cleared only by opening it; custom view bounds persist and Alt wheel changes depth without seeking', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#tutorial')).toHaveClass(/tutorial-unseen/);
  await page.reload(); await expect(page.locator('#tutorial')).toHaveClass(/tutorial-unseen/);
  await page.locator('#tutorial').click(); await page.locator('#close-modal').click();
  await page.reload(); await expect(page.locator('#tutorial')).not.toHaveClass(/tutorial-unseen/);
  await expect(page.locator('#depth-zoom')).toHaveValue('10'); await expect(page.locator('#depth-zoom')).toHaveAttribute('min', '2'); await expect(page.locator('#depth-zoom')).toHaveAttribute('max', '20');
  await expect(page.locator('#preview-range')).toHaveValue('3'); await expect(page.locator('#preview-range')).toHaveAttribute('max', '8');
  await page.locator('#preview').dispatchEvent('wheel', { deltaY: -100, altKey: true, clientX: 5, clientY: 5 });
  await expect(page.locator('#depth-zoom')).toHaveValue('11'); await expect(page.locator('#beat-input')).toHaveValue('0.000');
  await page.locator('#view-settings').click();
  await page.locator('#depthMin').fill('4'); await page.locator('#depthMax').fill('30'); await page.locator('#previewMax').fill('16');
  await page.locator('#default-depth').fill('25'); await page.locator('#default-preview-range').fill('12'); await page.locator('#view-apply').click();
  await expect(page.locator('#depth-zoom')).toHaveValue('25'); await expect(page.locator('#preview-range')).toHaveValue('12');
  await page.reload(); await expect(page.locator('#depth-zoom')).toHaveValue('25'); await expect(page.locator('#depth-zoom')).toHaveAttribute('max', '30');
  await page.locator('#view-settings').click(); await page.locator('#depthMin').fill('40'); await page.locator('#view-apply').click(); await expect(page.locator('#modal')).toBeVisible(); await expect(page.locator('#toast')).toContainText('最小值');
});

test('switching clean difficulties stays saved; actual edits survive switching, saving and reload', async ({ page }) => {
  await localSong(page);
  for (const name of ['Hard', 'Normal', 'Hard']) { await page.locator(`[data-chart="Ring/${name}Ring.yaml"]`).click(); await expect(page.locator('#source-path')).toHaveText(`Ring/${name}Ring.yaml`); await expect(page.locator('#save-state')).toHaveText('已保存'); }
  await page.locator('#add-at-beat').click(); await expect(page.locator('#save-state')).toHaveText('有未保存修改');
  await page.locator('[data-chart="Ring/NormalRing.yaml"]').click(); await expect(page.locator('#note-count')).toHaveText('0'); await expect(page.locator('#save-state')).toHaveText('有未保存修改');
  await page.locator('[data-chart="Ring/HardRing.yaml"]').click(); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('已保存');
  await page.locator('[data-chart="Ring/NormalRing.yaml"]').click(); await expect(page.locator('#save-state')).toHaveText('已保存');
  // Allow the draft debounce to run: navigation must not leave a dirty recovery draft.
  await page.waitForTimeout(700);
  await page.reload(); await page.locator('[data-chart="Ring/HardRing.yaml"]').click(); await expect(page.locator('#note-count')).toHaveText('1'); await expect(page.locator('#save-state')).toHaveText('已保存');
});

test('uppercase ZIP song packs import through audio picker; plain audio ZIP is attached to current song', async ({ page }) => {
  await page.goto('/'); const p = newProject(); p.info.songName = 'ZIP song';
  const zip = new JSZip().file('Song/Info.yaml', writeYaml(p.info)).file('Song/' + p.chartPath, writeYaml(p.chart)).file('Song/' + p.eventPath, writeYaml(p.event));
  await page.locator('#audio-input').setInputFiles({ name: 'SONG.ZIP', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#song-name')).toHaveText('ZIP song');
  const audio = new JSZip().file('audio/test.wav', Buffer.from('RIFF test audio'));
  await page.locator('#audio-input').setInputFiles({ name: 'audio.ZIP', mimeType: 'application/zip', buffer: await audio.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#toast')).toContainText('音频已载入'); await expect(page.locator('#song-name')).toHaveText('ZIP song');
});

test('passed notes disappear immediately, long foot notes remain until their end, and seeking restores geometry', async ({ page }) => {
  await page.goto('/'); const p = newProject(); p.chart.notes = [{ time: 1, lineIndex: 0, lineLayer: 0, type: 0, cutDirection: 8 }]; p.chart.ringNotes = [{ time: 1, lineIndex: 0, type: 0, ringNoteType: 0 }, { time: 1, lineIndex: 35, type: 1, ringNoteType: 1, duration: 1 }];
  const zip = new JSZip().file('Info.yaml', writeYaml(p.info)).file(p.chartPath, writeYaml(p.chart)).file(p.eventPath, writeYaml(p.event));
  await page.locator('#import-input').setInputFiles({ name: 'notes.ZIP', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  const counts = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => ['hand-notes', 'foot-notes'].map(name => (el.spatialPreview!.scene.getObjectByName(name) as import('three').InstancedMesh).count));
  const seek = async (beat: string) => { await page.locator('#beat-input').fill(beat); await page.keyboard.press('Enter'); };
  await expect.poll(counts).toEqual([1, 2]); await seek('1.01'); await expect.poll(counts).toEqual([0, 1]); await seek('2.01'); await expect.poll(counts).toEqual([0, 0]); await seek('1'); await expect.poll(counts).toEqual([1, 2]);
});
