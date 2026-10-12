import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';
import { newProject, newItem } from '../src/model';
import { findOverlaps } from '../src/diagnostics';
import { footTrack, obstacleBounds } from '../src/layout';

test('foot display spans -18..-1 and 1..18 without modifying native indices', () => {
  assert.deepEqual(Array.from({ length: 36 }, (_, i) => footTrack(i)), [...Array.from({ length: 18 }, (_, i) => i - 18), ...Array.from({ length: 18 }, (_, i) => i + 1)]);
});
test('same-place notes collide regardless of color or group, while different layers and wall extents do not', () => {
  const p = newProject();
  p.chart.notes = [{ time: 4, lineIndex: 0, lineLayer: 0, type: 0 }, { time: 4, lineIndex: 0, lineLayer: 0, type: 1, groupId: 'x' }, { time: 4, lineIndex: 0, lineLayer: 2, type: 0 }];
  p.chart.ringNotes = [{ time: 6, lineIndex: 18, ringNoteType: 0 }, { time: 6, lineIndex: 18, ringNoteType: 1, duration: 2 }];
  p.chart.obstacles = [{ time: 7, lineIndex: 0, width: 1, type: 0, duration: .5 }, { time: 7, lineIndex: 0, width: 1, type: 1, duration: .5 }];
  assert.deepEqual(findOverlaps(p).map(o => [o.kind, o.time, o.indices]), [['notes', 4, [0, 1]], ['ringNotes', 6, [0, 1]]]);
  p.chart.notes[1].lineIndex = 3; assert.equal(findOverlaps(p).length, 1);
  p.chart.obstacles.push({ ...p.chart.obstacles[1] }); assert.equal(findOverlaps(p).at(-1)?.kind, 'obstacles');
});
test('Caocao RingDance Hard second wall is type 1 and occupies only the upper half', () => {
  const chart = parse(fs.readFileSync('Map/caocao/RingDance/HardRingDance.yaml', 'utf8'));
  const wall = chart.obstacles[1]; assert.equal(wall.time, 5); assert.equal(wall.type, 1);
  const half = obstacleBounds(wall), full = obstacleBounds({ ...wall, type: 0 });
  assert.equal(half.height, full.height / 2);
  assert.equal(half.y + half.height / 2, full.y + full.height / 2);
  assert.ok(Math.abs(half.y - half.height / 2 - full.y) < 1e-10);
});

test('new obstacles use the common native thin-wall defaults for either height', () => {
  for (const type of [0, 1]) {
    const wall = newItem('obstacles', 7 / 3, 3, type);
    assert.deepEqual(wall, { time: 7 / 3, lineIndex: 3, duration: .04, width: 1, type });
  }
});
