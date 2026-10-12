import type { Item, Kind } from './model';

export type MirrorMode = 'left-right' | 'up-down' | 'diagonal';
/** Native-grid reflections: diagonal means both axes, not a 45-degree reflection. */
export function mirroredItem(kind: Kind, item: Item, mode: MirrorMode): Item {
  const n = { ...item }, flipX = mode !== 'up-down', flipY = mode !== 'left-right';
  if (kind === 'events') return n;
  if (kind === 'notes') {
    if (flipX) n.lineIndex = 3 - n.lineIndex;
    if (flipY) n.lineLayer = 2 - n.lineLayer;
  } else if (flipX) n.lineIndex = kind === 'ringNotes' ? 35 - n.lineIndex : 4 - n.lineIndex - n.width;
  return n;
}
