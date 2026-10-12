import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillPlans, buildFill, fillEndpoints, nearestFillPlan, maxFillNotes, type FillDirection } from '../src/fill.ts';
import { handPositions, handLane } from '../src/layout.ts';
import { validateChart } from '../src/model.ts';

const note = (lane: number, time: number, type = 0) => ({ time, lineIndex: handPositions[lane][0], lineLayer: handPositions[lane][1], type, cutDirection: 8 });
test('every legal plan advances one sector per tick and lands exactly on any endpoint in both directions', () => {
  for (let from = 0; from < 10; from++) for (let to = 0; to < 10; to++) for (const direction of ['clockwise', 'counterclockwise'] as FillDirection[]) {
    const a = note(from, .125), b = note(to, 3.875, 1), before = structuredClone([a, b]);
    const plans = fillPlans(b, a, direction);
    assert.ok(plans.length >= 204); assert.ok(plans.every(p => p.steps - 1 <= maxFillNotes));
    for (const plan of [plans[0], plans[1], plans.at(-1)!]) {
      const { notes, skipped } = buildFill(b, a, plan, [a, b]);
      assert.equal(notes.length, plan.steps - 1); assert.equal(skipped, 0);
      assert.deepEqual(validateChart({ notes }), []);
      const path = [a, ...notes, b];
      for (let i = 1; i < path.length; i++) {
        assert.equal((handLane(path[i].lineIndex, path[i].lineLayer) - handLane(path[i - 1].lineIndex, path[i - 1].lineLayer) + 10) % 10, direction === 'clockwise' ? 1 : 9);
        assert.ok(Math.abs(path[i].time - path[i - 1].time - plan.spacing) < 1e-12);
      }
      assert.ok(notes.every(n => n.type === a.type));
    }
    assert.deepEqual([a, b], before);
  }
});
test('fractional denominators, same-position endpoints, tiny intervals, and invalid pairs', () => {
  const a = note(0, 1.25), b = note(3, 3.75);
  const plans = fillPlans(a, b, 'clockwise');
  assert.equal(plans[0].denominator, 1.2); assert.equal(plans[1].steps, 13);
  assert.equal(nearestFillPlan(plans, 4), 1);
  assert.equal(fillPlans(a, note(0, 5), 'clockwise')[0].steps, 10);
  assert.equal(fillEndpoints(a, note(2, a.time)), undefined);
  assert.equal(fillEndpoints(a, { ...b, lineIndex: 1, lineLayer: 1 }), undefined);
  assert.deepEqual(fillPlans(note(0, 0), note(9, .000002), 'clockwise'), []);
  assert.ok(fillPlans(note(0, 0), note(2, .000002), 'clockwise').every(p => p.denominator <= 1e6));
});
test('existing notes are reused without changing color or metadata and shared groups are retained', () => {
  const a = { ...note(0, 0), groupId: 'g', groupNoteType: 1 }, b = { ...note(4, 1, 1), groupId: 'g', groupNoteType: 2 };
  const existing = { ...note(2, .5, 1), extension: 'keep', groupId: 'other' };
  const before = structuredClone([a, b, existing]);
  const result = buildFill(a, b, fillPlans(a, b, 'clockwise')[0], [a, b, existing]);
  assert.equal(result.skipped, 1); assert.equal(result.notes.length, 2);
  assert.ok(result.notes.every(n => n.groupId === 'g' && !('groupNoteType' in n)));
  assert.deepEqual([a, b, existing], before);
  assert.ok(buildFill(a, { ...b, groupId: 'different' }, fillPlans(a, b, 'clockwise')[0], []).notes.every(n => !('groupId' in n)));
});
