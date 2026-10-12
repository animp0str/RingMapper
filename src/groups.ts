import { items, type Project, type Item } from './model';
import type { Selection } from './render';
export type GroupAction = 'create' | 'join' | 'ungroup';
export function groupingOptions(project: Project, refs: Selection[]) {
  const notes = refs.filter(r => r.kind === 'notes').map(r => items(project, 'notes')[r.index]).filter(Boolean);
  const onlyHands = !!notes.length && notes.length === refs.length;
  const ids = [...new Set(notes.map(n => n.groupId).filter(Boolean))] as string[];
  const grouped = onlyHands && notes.every(n => n.groupId);
  const canCreate = onlyHands && !grouped && notes.length >= 2 && notes.every(n => n.type === 0 || n.type === 1);
  return { canCreate, canJoin: canCreate && ids.length > 0, canUngroup: grouped, ids };
}
/** Repair only groups touched by an edit; never rewrite imported groups on load. */
export function repairGroups(project: Project, ids: Set<string>) {
  for (const id of ids) {
    const notes = items(project, 'notes').filter(n => n.groupId === id).sort((a, b) => a.time - b.time);
    for (const n of notes) { delete n.groupNoteType; if (notes.length < 2) delete n.groupId; }
    if (notes.length >= 2) { notes[0].groupNoteType = 1; notes.at(-1)!.groupNoteType = 2; }
  }
}
export function applyGrouping(project: Project, refs: Selection[], action: GroupAction, targetId?: string) {
  const options = groupingOptions(project, refs);
  if (action === 'create' && !options.canCreate || action === 'join' && (!options.canJoin || !targetId || !options.ids.includes(targetId)) || action === 'ungroup' && !options.canUngroup) return false;
  const touched = new Set(options.ids);
  if (action === 'ungroup') {
    for (const n of items(project, 'notes')) if (touched.has(n.groupId)) { delete n.groupId; delete n.groupNoteType; }
  } else {
    const id = action === 'join' ? targetId! : crypto.randomUUID(); touched.add(id);
    for (const ref of refs) { const n = items(project, 'notes')[ref.index]; n.groupId = id; delete n.groupNoteType; }
    repairGroups(project, touched);
  }
  return true;
}
export function groupHeads(notes: Item[]) {
  const groups = new Map<string, { note: Item; index: number }>();
  notes.forEach((note, index) => { if (note.groupId) { const previous = groups.get(note.groupId); if (!previous || note.time < previous.note.time) groups.set(note.groupId, { note, index }); } });
  return new Set([...groups.values()].map(g => g.index));
}
