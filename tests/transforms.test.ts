import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirroredItem, type MirrorMode } from '../src/transforms.ts';
import { handPositions, isHandPosition, noteDepth, durationExtent, stage } from '../src/layout.ts';

const modes: MirrorMode[] = ['left-right', 'up-down', 'diagonal'];
test('all mirror modes preserve the ten legal hand positions and are exactly reversible', () => {
  for (const mode of modes) for (const [lineIndex, lineLayer] of handPositions) for (let cutDirection = 0; cutDirection <= 8; cutDirection++) for (const type of [0, 1, 3]) {
    const n = { time: 8.125, lineIndex, lineLayer, cutDirection, type, groupId: 'group-1', groupNoteType: 1, custom: { retained: true } };
    const transformed = mirroredItem('notes', n, mode);
    assert.ok(isHandPosition(transformed.lineIndex, transformed.lineLayer));
    assert.equal(transformed.time, n.time); assert.equal(transformed.groupId, n.groupId);
    assert.deepEqual(transformed.custom, n.custom);
    assert.deepEqual(mirroredItem('notes', transformed, mode), n);
  }
});
test('up-down reflects layers and stroke directions; diagonal reflects both axes and swaps hands', () => {
  const n = { time: 0, lineIndex: 0, lineLayer: 2, type: 0, cutDirection: 4 };
  assert.deepEqual(mirroredItem('notes', n, 'up-down'), { ...n, lineLayer: 0, cutDirection: 6 });
  assert.deepEqual(mirroredItem('notes', n, 'diagonal'), { ...n, lineIndex: 3, lineLayer: 0, type: 1, cutDirection: 7 });
  const withoutDirection = { time: 0, lineIndex: 3, lineLayer: 1, type: 1 };
  assert.equal(Object.hasOwn(mirroredItem('notes', withoutDirection, 'up-down'), 'cutDirection'), false);
});
test('mirrors keep holds, obstacle widths, event data and extension fields intact', () => {
  const foot = { time: 2, lineIndex: 5, type: 1, ringNoteType: 1, duration: 4, extension: 'keep' };
  const wall = { time: 2, lineIndex: 0, width: 2, duration: '0.1', type: 1 };
  const event = { time: 2, type: 101, value: 2 };
  for (const mode of modes) {
    assert.deepEqual(mirroredItem('ringNotes', mirroredItem('ringNotes', foot, mode), mode), foot);
    assert.deepEqual(mirroredItem('obstacles', mirroredItem('obstacles', wall, mode), mode), wall);
    assert.deepEqual(mirroredItem('events', event, mode), event);
  }
  assert.deepEqual(mirroredItem('ringNotes', foot, 'up-down'), foot);
  assert.deepEqual(mirroredItem('obstacles', wall, 'up-down'), wall);
  assert.equal(mirroredItem('ringNotes', foot, 'diagonal').lineIndex, 30);
  assert.equal(mirroredItem('obstacles', wall, 'diagonal').lineIndex, 2);
});
test('3D spacing scales note depth and active hold extents without changing beat data', () => {
  const note = { time: 4, duration: 4 }, before = { ...note };
  for (const factor of [.25, 1, 2, 3]) {
    assert.equal(noteDepth(8, 4, stage.beatSpacing * factor), noteDepth(8, 4) * factor);
    const held = durationExtent(note, 6, stage.beatSpacing * factor);
    assert.equal(held.front, 0); assert.equal(held.back, noteDepth(8, 6) * factor);
    assert.equal(held.length, durationExtent(note, 6).length * factor);
  }
  assert.deepEqual(note, before);
});
