import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newProject, newItem, validateChart, decodeText, readYaml, writeYaml, History, beatToSeconds, secondsToBeat, snap, updateMetadata, sortedProject } from '../src/model.ts';
import { LocalWorkspace, localPath } from '../src/workspace.ts';
import { ReadDirectory } from './read-directory.ts';
import { handPositions, handLane, isHandPosition, handWorldPosition, noteDepth, durationExtent, stage } from '../src/layout.ts';
import { bands, timelineHit, timelineLane } from '../src/render.ts';
test('beat and audio offset convert both ways; snapping retains fractions', () => {
  for (const bpm of [84, 144, 222.22]) for (const beat of [0, 1.125, 210]) assert.ok(Math.abs(secondsToBeat(beatToSeconds(beat, bpm, -.2), bpm, -.2) - beat) < 1e-9);
  assert.equal(snap(1.14, 8), 1.125); assert.equal(snap(-5, 4), 0);
});
test('undo redo preserves extension and group fields; branch clears redo', () => {
  const p = newProject(), history = new History(); p.chart.notes = [{ time: 1, lineIndex: 0, lineLayer: 1, type: 0, cutDirection: 8, groupId: '1234567890123456789', customData: { foo: 'bar' } }];
  history.push(p); p.chart.notes[0].time = 2;
  const old = history.undo(p)!; assert.equal(old.chart.notes![0].time, 1); assert.equal(old.chart.notes![0].groupId, '1234567890123456789');
  assert.equal(history.redo(old)!.chart.notes![0].time, 2); history.push(p); assert.equal(history.redo(p), undefined);
});
test('new projects serialize with native schema and updated counts', () => {
  const p = newProject(); p.chart.notes = [newItem('notes', 3, 1), { ...newItem('notes', 2, 2), type: 3 }]; p.chart.ringNotes = [{ ...newItem('ringNotes', 1, 35), ringNoteType: 1, duration: 4 }];
  updateMetadata(p); const entry = p.info.difficultyCiphermapSets[0].difficultyCiphermaps[0];
  assert.equal(entry.noteNum, 1); assert.equal(entry.mineNum, 1); assert.equal(entry.blockNum, 2); assert.equal(validateChart(p.chart).length, 0);
  const sorted = sortedProject(p); assert.equal(sorted.chart.notes![0].time, 2); assert.equal(p.chart.notes[0].time, 3); assert.deepEqual(readYaml(writeYaml(p.chart)), p.chart);
});
test('rejects invalid timing and out-of-range positions', () => {
  const chart = { notes: [{ time: -1, lineIndex: 4, lineLayer: 9, type: 0, cutDirection: 8 }], ringNotes: [{ time: 0, lineIndex: 36, duration: -2 }] };
  assert.ok(validateChart(chart).length >= 5); assert.throws(() => readYaml('- one\n- two'));
});
test('path guards reject traversal, absolute paths and NTFS streams', () => {
  const root = path.resolve('Map'); assert.deepEqual(localPath('test/Ring/Easy.yaml'), ['test', 'Ring', 'Easy.yaml']);
  for (const input of ['../README.md', 'x/../../README.md', 'x:stream', root]) assert.throws(() => localPath(input));
});
test('ring contains only the ten perimeter positions of the 4 x 3 source grid', () => {
  assert.equal(handPositions.length, 10);
  assert.equal(new Set(handPositions.map(p => p.join(','))).size, 10);
  for (let col = 0; col < 4; col++) for (let layer = 0; layer < 3; layer++) {
    const active = layer !== 1 || col === 0 || col === 3;
    assert.equal(isHandPosition(col, layer), active);
    assert.equal(handWorldPosition(col, layer) !== undefined, active);
    const chart = { notes: [{ time: 0, lineIndex: col, lineLayer: layer, type: 0, cutDirection: 8 }] };
    assert.equal(validateChart(chart).length === 0, active);
  }
});
test('timeline hit testing and note placement use the same ten positions as the ring', () => {
  const project = newProject();
  const state = { project, beat: 0, start: 0, scale: 48, division: 4, active: 'notes' as const, mode: 'notes' as const, overlaps: [], ringRotation: 0, ringReverse: false };
  assert.equal(bands.notes.lanes, 10);
  handPositions.forEach(([lineIndex, lineLayer], index) => {
    assert.equal(handLane(lineIndex, lineLayer), index);
    const y = bands.notes.top + (index + .5) / 10 * bands.notes.height;
    const hit = timelineHit(86 + 48, y, state)!;
    assert.equal(hit.kind, 'notes'); assert.equal(hit.lane, index); assert.equal(hit.time, 1);
    assert.equal(timelineLane('notes', { time: 1, lineIndex, lineLayer }), index);
    const mirrored = { time: 1, lineIndex: 3 - lineIndex, lineLayer };
    assert.ok(timelineLane('notes', mirrored) >= 0);
  });
});
test('3D ring rotation preserves radius and notes approach the judgment plane in depth', () => {
  for (const reverse of [false, true]) for (const rotation of [0, 90, 180]) for (const [col, layer] of handPositions) {
    const p = handWorldPosition(col, layer, rotation, reverse)!;
    assert.ok(Math.abs(Math.hypot(p.x / stage.ringScaleX, p.y - stage.ringY) - stage.radius) < 1e-9);
  }
  assert.ok(noteDepth(8, 4) < noteDepth(8, 6)); assert.equal(noteDepth(8, 8), 0);
  const full = durationExtent({ time: 4, duration: 4 }, 0), held = durationExtent({ time: 4, duration: 4 }, 6);
  assert.ok(full.back < full.front); assert.equal(held.front, 0); assert.ok(held.length < full.length);
});
test('catalog scans actual files despite stale metadata references', async () => {
  const songs = await new LocalWorkspace({ id: 'corpus', handle: new ReadDirectory(path.resolve('Map')) }).catalog(); assert.ok(songs.length >= 137); const legacy = songs.find(s => s.id === '3n3rgizer')!;
  assert.ok(legacy.charts.some(c => c.path === 'Ring/EasyRing.yaml')); assert.ok(legacy.warnings.length > 0);
});
test('every repository YAML round-trips semantically and all charts validate', { timeout: 600000 }, async () => {
  const paths = (await fs.readdir('Map', { recursive: true })).filter(p => p.endsWith('.yaml')); let charts = 0;
  for (const filename of paths) {
    const data = readYaml(decodeText(await fs.readFile(path.join('Map', filename))));
    assert.deepEqual(readYaml(writeYaml(data)), data, filename);
    if (data.notes || data.ringNotes) { assert.deepEqual(validateChart(data), [], filename); charts++; }
  }
  assert.ok(charts >= 603);
});
