import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { newProject, writeYaml } from '../../src/model';

async function blankEditor(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('Diabolic Swing');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
}

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
  await expect(page.locator('#preview-range')).toHaveValue('4'); await expect(page.locator('#preview-range')).toHaveAttribute('max', '8');
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
  await blankEditor(page); const p = newProject(); p.info.songName = 'ZIP song';
  const zip = new JSZip().file('Song/Info.yaml', writeYaml(p.info)).file('Song/' + p.chartPath, writeYaml(p.chart)).file('Song/' + p.eventPath, writeYaml(p.event));
  await page.locator('#audio-input').setInputFiles({ name: 'SONG.ZIP', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await page.locator('#discard').click();
  await expect(page.locator('#song-name')).toHaveText('ZIP song');
  const audio = new JSZip().file('audio/test.wav', Buffer.from('RIFF test audio'));
  await page.locator('#audio-input').setInputFiles({ name: 'audio.ZIP', mimeType: 'application/zip', buffer: await audio.generateAsync({ type: 'nodebuffer' }) });
  await expect(page.locator('#toast')).toContainText('音频已载入'); await expect(page.locator('#song-name')).toHaveText('ZIP song');
});

test('passed notes disappear immediately, long foot notes remain until their end, and seeking restores geometry', async ({ page }) => {
  await blankEditor(page); const p = newProject(); p.chart.notes = [{ time: 1, lineIndex: 0, lineLayer: 0, type: 0, cutDirection: 8 }]; p.chart.ringNotes = [{ time: 1, lineIndex: 0, type: 0, ringNoteType: 0 }, { time: 1, lineIndex: 35, type: 1, ringNoteType: 1, duration: 1 }];
  const zip = new JSZip().file('Info.yaml', writeYaml(p.info)).file(p.chartPath, writeYaml(p.chart)).file(p.eventPath, writeYaml(p.event));
  await page.locator('#import-input').setInputFiles({ name: 'notes.ZIP', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  const counts = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => ['hand-notes', 'foot-notes'].map(name => (el.spatialPreview!.scene.getObjectByName(name) as import('three').InstancedMesh).count));
  const seek = async (beat: string) => { await page.locator('#beat-input').fill(beat); await page.keyboard.press('Enter'); };
  await expect.poll(counts).toEqual([1, 2]); await seek('1.01'); await expect.poll(counts).toEqual([0, 1]); await seek('2.01'); await expect.poll(counts).toEqual([0, 0]); await seek('1'); await expect.poll(counts).toEqual([1, 2]);
});


test('pause snaps the current playhead in either direction and rapid virtual toggles do not accumulate progress', async ({ page }) => {
  await blankEditor(page);
  const togglePair = async (at: number, count = 1) => page.evaluate(({ at, count }) => {
    const seek = document.querySelector<HTMLInputElement>('#seek')!;
    seek.value = String(at); seek.dispatchEvent(new Event('input', { bubbles: true }));
    const play = document.querySelector<HTMLButtonElement>('#play')!;
    for (let i = 0; i < count; i++) { play.click(); play.click(); }
  }, { at, count });
  await togglePair(2.14); await expect(page.locator('#beat-input')).toHaveValue('2.250');
  await togglePair(2.09); await expect(page.locator('#beat-input')).toHaveValue('2.000');
  await page.locator('#division').selectOption('3'); await togglePair(2.18); await expect(page.locator('#beat-input')).toHaveValue('2.333');
  await page.locator('#division').selectOption('4'); await togglePair(2, 20); await expect(page.locator('#beat-input')).toHaveValue('2.000');
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space'); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space'); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  expect(Number(await page.locator('#seek').inputValue()) * 4 % 1).toBeCloseTo(0, 6);
});

function silentWave() {
  const samples = 8000 * 10, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40); return data;
}

test('pending audio play requests can be paused and stale promises cannot restart or stop newer playback', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    (window as any).__plays = [];
    (window as any).Audio = function () {
      const audio = new NativeAudio(); (window as any).__audio = audio;
      audio.play = () => new Promise<void>((resolve, reject) => (window as any).__plays.push({ resolve, reject }));
      return audio;
    };
  });
  await blankEditor(page);
  await page.locator('#audio-input').setInputFiles({ name: 'test.wav', mimeType: 'audio/wav', buffer: silentWave() });
  await expect.poll(() => page.evaluate(() => (window as any).__audio.readyState)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('#seek')!; input.value = '2.14'; input.dispatchEvent(new Event('input')); });
  await page.locator('#play').click(); await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play').click(); await expect(page.locator('#beat-input')).toHaveValue('2.250');
  expect(await page.evaluate(() => (window as any).__audio.currentTime)).toBeCloseTo(1.125, 5);
  await page.evaluate(() => (window as any).__plays[0].resolve());
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#play').click(); await page.locator('#play').click(); await page.locator('#play').click();
  await page.evaluate(() => (window as any).__plays[1].reject(new DOMException('Paused', 'AbortError')));
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toast')).not.toContainText('音频无法播放');
  await page.locator('#play').click(); await page.evaluate(() => (window as any).__plays[2].resolve());
  await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#beat-input')).toHaveValue('2.250');
});

test('hovered bookmark deletion is undoable and does not delete selected notes or consume text editing', async ({ page }) => {
  await blankEditor(page); await page.locator('#add-at-beat').click(); await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b'); await expect(page.locator('.seek-bookmark')).toHaveCount(1);
  await page.locator('.seek-bookmark').hover(); await page.keyboard.press('Delete');
  await expect(page.locator('.seek-bookmark')).toHaveCount(0); await expect(page.locator('#note-count')).toHaveText('1');
  await page.keyboard.press('Control+z'); await expect(page.locator('.seek-bookmark')).toHaveCount(1);
  await page.locator('#search').fill('text'); await page.locator('.seek-bookmark').hover(); await page.keyboard.press('Delete');
  await expect(page.locator('.seek-bookmark')).toHaveCount(1);
});

test('song library collapses left, expands the canvas and can reopen after reload', async ({ page }) => {
  await page.goto('/'); const before = await page.locator('#preview').boundingBox();
  await page.locator('#toggle-library').click(); await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#song-library')).toBeHidden();
  const after = await page.locator('#preview').boundingBox(); expect(after!.width).toBeGreaterThan(before!.width + 150); expect(after!.x).toBe(0);
  await page.reload(); await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#toggle-library').click(); await expect(page.locator('#song-library')).toBeVisible(); await expect(page.locator('#toggle-library')).toHaveAttribute('aria-expanded', 'true');
  const restored = await page.locator('#preview').boundingBox(); expect(restored!.width).toBe(before!.width);
});
