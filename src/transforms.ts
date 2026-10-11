import type { Item, Kind } from './model';

export type MirrorMode = 'left-right' | 'up-down' | 'diagonal';
const directions: Record<MirrorMode, number[]> = {
  'left-right': [0, 1, 3, 2, 5, 4, 7, 6, 8],
  'up-down': [1, 0, 2, 3, 6, 7, 4, 5, 8],
  diagonal: [1, 0, 3, 2, 7, 6, 5, 4, 8],
};
/** Native-grid reflections: diagonal means both axes, not a 45-degree reflection. */
export function mirroredItem(kind: Kind, item: Item, mode: MirrorMode): Item {
  const n = { ...item }, flipX = mode !== 'up-down', flipY = mode !== 'left-right';
  if (kind === 'events') return n;
  if (kind === 'notes') {
    if (flipX) n.lineIndex = 3 - n.lineIndex;
    if (flipY) n.lineLayer = 2 - n.lineLayer;
    if (directions[mode][n.cutDirection] !== undefined) n.cutDirection = directions[mode][n.cutDirection];
  } else if (flipX) n.lineIndex = kind === 'ringNotes' ? 35 - n.lineIndex : 4 - n.lineIndex - n.width;
  // Left/right reflection also swaps hands; top/bottom alone keeps hand identity.
  if (flipX && (kind === 'notes' || kind === 'ringNotes') && (n.type === 0 || n.type === 1)) n.type = 1 - n.type;
  return n;
}
