import { handLane, handPositions } from './layout';
import type { Item } from './model';

export type FillDirection = 'clockwise' | 'counterclockwise';
export type FillPlan = { direction: FillDirection; steps: number; denominator: number; spacing: number };
export const maxFillNotes = 2048;

/** Endpoints are chronological, regardless of selection order. Same-beat pairs have no interval to fill. */
export function fillEndpoints(a: Item, b: Item): [Item, Item] | undefined {
  if (![a, b].every(n => Number.isFinite(n.time) && n.time >= 0 && handLane(n.lineIndex, n.lineLayer) >= 0)) return;
  const pair: [Item, Item] = a.time < b.time ? [a, b] : [b, a];
  if (pair[1].time - pair[0].time < .000001) return;
  return pair;
}

/** One sector per step: steps ≡ directed distance (mod 10). Extra full turns yield all denser paths. */
export function fillPlans(a: Item, b: Item, direction: FillDirection): FillPlan[] {
  const pair = fillEndpoints(a, b); if (!pair) return [];
  const [start, end] = pair, span = end.time - start.time;
  const sign = direction === 'clockwise' ? 1 : -1;
  const distance = ((handLane(end.lineIndex, end.lineLayer) - handLane(start.lineIndex, start.lineLayer)) * sign + 10) % 10;
  const plans: FillPlan[] = [];
  // Keep notes distinct at the editor's supported maximum snap denominator of 1,000,000.
  const maxSteps = Math.min(maxFillNotes + 1, Math.floor(span * 1e6 + 1e-7));
  for (let steps = distance; steps <= maxSteps; steps += 10) {
    if (steps < 2) continue; // At least one new note; endpoints themselves are never generated.
    plans.push({ direction, steps, denominator: steps / span, spacing: span / steps });
  }
  return plans;
}

export function nearestFillPlan(plans: FillPlan[], denominator: number) {
  return plans.reduce((best, plan, i) => Math.abs(plan.denominator - denominator) < Math.abs(plans[best].denominator - denominator) ? i : best, 0);
}

/** Keep existing objects and endpoint colors intact; never create a second object in an occupied slot. */
export function buildFill(a: Item, b: Item, plan: FillPlan, existing: Item[]) {
  const pair = fillEndpoints(a, b);
  if (!pair || !fillPlans(a, b, plan.direction).some(p => p.steps === plan.steps)) throw new Error('无效的圆环填充方案');
  const [start, end] = pair, lane = handLane(start.lineIndex, start.lineLayer), sign = plan.direction === 'clockwise' ? 1 : -1;
  const key = (n: Item) => `${n.time.toFixed(7)}:${n.lineIndex}:${n.lineLayer}`;
  const occupied = new Set(existing.map(key)), notes: Item[] = [];
  let skipped = 0;
  for (let step = 1; step < plan.steps; step++) {
    const [lineIndex, lineLayer] = handPositions[((lane + sign * step) % 10 + 10) % 10];
    const time = start.time + (end.time - start.time) * (step / plan.steps);
    const note: Item = { time, lineIndex, lineLayer, type: start.type, cutDirection: start.cutDirection ?? 8 };
    if (occupied.has(key(note))) { skipped++; continue; }
    if (start.groupId && start.groupId === end.groupId) note.groupId = start.groupId;
    notes.push(note); occupied.add(key(note));
  }
  return { notes, skipped };
}
