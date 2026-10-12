import { items, type Project, type Kind } from './model';
export type Overlap = { kind: Kind; time: number; indices: number[] };
/** Color/direction/group metadata cannot distinguish two notes occupying the same place. */
export function findOverlaps(project: Project): Overlap[] {
  const result: Overlap[] = [];
  for (const kind of ['notes', 'ringNotes', 'obstacles'] as const) {
    const occupied = new Map<string, Overlap>();
    items(project, kind).forEach((n, index) => {
      const key = [Number(n.time).toFixed(7), n.lineIndex,
        kind === 'notes' ? n.lineLayer : '',
        kind === 'obstacles' ? `${n.width ?? 1}:${n.type ?? 0}:${Number(n.duration ?? 0).toFixed(7)}` : ''].join(':');
      const entry = occupied.get(key) ?? { kind, time: n.time, indices: [] };
      entry.indices.push(index); occupied.set(key, entry);
    });
    result.push(...[...occupied.values()].filter(entry => entry.indices.length > 1));
  }
  return result.sort((a, b) => a.time - b.time);
}
