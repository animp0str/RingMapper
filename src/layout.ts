import type { Item } from './model';

/** Clockwise perimeter of the original 4-column, 3-layer grid. */
export const handPositions: readonly (readonly [number, number])[] = [
  [0, 2], [1, 2], [2, 2], [3, 2], [3, 1],
  [3, 0], [2, 0], [1, 0], [0, 0], [0, 1],
];
export function handLane(lineIndex: number, lineLayer: number) {
  return handPositions.findIndex(([column, layer]) => column === lineIndex && layer === lineLayer);
}
export function isHandPosition(lineIndex: number, lineLayer: number) { return handLane(lineIndex, lineLayer) >= 0; }
export const stage = { ringY: 2.65, radius: 1.55, ringScaleX: 1.16, footWidth: 4.6, footY: .3, beatSpacing: 1.65 };
/** Visual footprint estimated from the reference; position indices remain independent of pedal width. */
export const footNoteSize = { width: stage.footWidth * .45, height: .16, depth: 1.15 };
export function handAngle(sector: number, rotation = 0, reverse = false) {
  return (144 - (reverse ? -sector : sector) * 36 + rotation) * Math.PI / 180;
}
export function handWorldPosition(lineIndex: number, lineLayer: number, rotation = 0, reverse = false) {
  const sector = handLane(lineIndex, lineLayer);
  if (sector < 0) return undefined;
  const a = handAngle(sector, rotation, reverse);
  return { x: Math.cos(a) * stage.radius * stage.ringScaleX, y: stage.ringY + Math.sin(a) * stage.radius, z: 0 };
}
export function footX(lineIndex: number) { return ((lineIndex + .5) / 36 - .5) * stage.footWidth; }
export function noteDepth(time: number, beat: number, spacing = stage.beatSpacing) { return (beat - time) * spacing; }
/** Front/back faces of a hold or wall, clipped to the judgment plane while active. */
export function durationExtent(n: Item, beat: number, spacing = stage.beatSpacing) {
  const front = Math.min(0, noteDepth(n.time, beat, spacing));
  const back = noteDepth(n.time + Number(n.duration ?? 0), beat, spacing);
  return { front, back, length: Math.max(.035, front - back), center: (front + back) / 2 };
}

