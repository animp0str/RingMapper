import { isHandPosition, defaultObstacleDuration } from './layout';
import { parse, stringify } from 'yaml';
export type Item = { time: number; [key: string]: any };
export type Kind = 'ringNotes' | 'notes' | 'obstacles' | 'events';
export type Chart = { version?: string; notes?: Item[]; ringNotes?: Item[]; obstacles?: Item[]; [key: string]: any };
export type Project = { info: Record<string, any>; chart: Chart; event: Record<string, any>; chartPath: string; eventPath: string; songId: string; workspaceId?: string; exampleId?: string; revision?: string };
export type ChartEntry = { path: string; eventPath: string; mode: string; difficulty: string };
export type Song = { id: string; name: string; artist: string; bpm: number; duration: number; cover: string; audio: string; charts: ChartEntry[]; warnings: string[] };
export const kinds: Kind[] = ['ringNotes', 'notes', 'obstacles', 'events'];
export const labels: Record<Kind, string> = { ringNotes: '脚部', notes: '手部 · 圆环', obstacles: '障碍物', events: '事件' };
export function decodeText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
}
export function readYaml(text: string): Record<string, any> {
  const value = parse(text, { maxAliasCount: 100 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('YAML 顶层必须是对象');
  return value;
}
export function writeYaml(value: unknown) { return stringify(value, { lineWidth: 0, sortMapEntries: false }); }
export function items(p: Project, kind: Kind): Item[] { return kind === 'events' ? (p.event.events ?? []) : (p.chart[kind] ?? []); }
export function ensureItems(p: Project, kind: Kind): Item[] { const root = kind === 'events' ? p.event : p.chart; return root[kind] ??= []; }
export function beatToSeconds(beat: number, bpm: number, offset = 0) { return beat * 60 / bpm + offset; }
export function secondsToBeat(seconds: number, bpm: number, offset = 0) { return (seconds - offset) * bpm / 60; }
export function snap(beat: number, division: number) { return Math.max(0, Math.round(beat * division) / division); }
export function newItem(kind: Kind, time: number, lineIndex: number, type = 0): Item {
  if (kind === 'ringNotes') return { time, lineIndex, ringNoteType: 0, type };
  if (kind === 'notes') {
    if (!isHandPosition(lineIndex, 0)) throw new Error('无效的手部位置');
    return { time, lineIndex, lineLayer: 0, type, cutDirection: 8 };
  }
  if (kind === 'obstacles') return { time, lineIndex, duration: defaultObstacleDuration, width: 1, type };
  return { time, type: lineIndex, value: 1 };
}
export function validateChart(chart: Chart, event: Record<string, any> = {}): string[] {
  const errors: string[] = [];
  for (const kind of kinds) {
    const list = kind === 'events' ? event.events : chart[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`${kind} 必须是数组`); continue; }
    list.forEach((n: Item, i: number) => {
      const at = `${kind}[${i}]`;
      if (!n || typeof n !== 'object') { errors.push(`${at} 必须是对象`); return; }
      if (!Number.isFinite(n.time) || n.time < 0) errors.push(`${at}.time 必须是非负数字`);
      for (const key of ['lineIndex', 'lineLayer', 'type', 'cutDirection', 'ringNoteType', 'width', 'value']) {
        if (n[key] !== undefined && !Number.isInteger(n[key])) errors.push(`${at}.${key} 必须是整数`);
      }
      if (n.duration !== undefined && (!((typeof n.duration === 'number' || typeof n.duration === 'string' && /^\d+(\.\d+)?$/.test(n.duration)) && Number.isFinite(Number(n.duration))) || Number(n.duration) < 0)) errors.push(`${at}.duration 必须是非负数字`);
      if (kind !== 'events' && (!Number.isInteger(n.lineIndex) || n.lineIndex < 0 || n.lineIndex > (kind === 'ringNotes' ? 35 : 3))) errors.push(`${at}.lineIndex 超出范围`);
      if (kind === 'notes' && n.lineLayer === 1 && (n.lineIndex === 1 || n.lineIndex === 2)) errors.push(`${at} 位于未使用的网格内部位置 (${n.lineIndex},1)，圆环仅使用外圈 10 个位置`);
      if (kind === 'notes' && (!Number.isInteger(n.lineLayer) || n.lineLayer < 0 || n.lineLayer > 2)) errors.push(`${at}.lineLayer 应为 0–2`);
    });
  }
  return errors;
}
export function sortedProject(p: Project): Project {
  const copy = structuredClone(p);
  for (const kind of kinds) if ((kind === 'events' ? copy.event : copy.chart)[kind]) items(copy, kind).sort((a, b) => a.time - b.time);
  return copy;
}
export function newProject(): Project {
  return {
    songId: '', chartPath: 'Ring/NormalRing.yaml', eventPath: 'Ring/NormalRingEvent.yaml',
    info: { version: '2.3.0', songName: '未命名歌曲', songAuthorName: '', levelAuthorName: '', beatsPerMinute: 120, songTimeOffset: 0, songDuration: 120, songFilename: 'song.ogg', coverImageFilename: 'cover.png', environmentName: 'DefaultEnvironment', difficultyCiphermapSets: [{ ciphermapCharacteristicName: 'Ring', difficultyCiphermaps: [{ difficulty: 'Normal', difficultyRank: 3, ciphermapFilename: 'Ring/NormalRing.yaml', eventmapFilename: 'Ring/NormalRingEvent.yaml', noteJumpMovementSpeed: 10, ringNoteJumpMovementSpeed: 10, noteJumpStartBeatOffset: 2, ringNoteJumpStartBeatOffset: 2 }] }] },
    chart: { version: '2.3.0', notes: [], ringNotes: [], obstacles: [], customData: { bookmarks: [] } }, event: { version: '2.3.0', events: [] },
  };
}
export function updateMetadata(p: Project) {
  const allSets = [...(p.info.difficultyCiphermapSets ?? []), ...(p.info.difficultyBeatmapSets ?? [])];
  let found = false;
  for (const set of allSets) for (const entry of set.difficultyCiphermaps ?? set.difficultyBeatmaps ?? []) {
    if ((entry.ciphermapFilename ?? entry.beatmapFilename)?.replaceAll('\\', '/') !== p.chartPath) continue;
    found = true;
    entry.noteNum = (p.chart.notes ?? []).filter((n: Item) => n.type !== 3).length;
    entry.mineNum = (p.chart.notes ?? []).filter((n: Item) => n.type === 3).length;
    entry.ringNoteNum = (p.chart.ringNotes ?? []).length;
    entry.blockNum = entry.noteNum + entry.ringNoteNum;
    entry.obstacleNum = (p.chart.obstacles ?? []).length;
    entry.eventmapFilename = p.eventPath;
  }
  if (!found) {
    const mode = p.chartPath.split('/')[0] || 'Ring';
    const sets = p.info.difficultyCiphermapSets ??= [];
    let set = sets.find((s: any) => s.ciphermapCharacteristicName === mode);
    if (!set) sets.push(set = { ciphermapCharacteristicName: mode, difficultyCiphermaps: [] });
    set.difficultyCiphermaps.push({ difficulty: p.chartPath.split('/').pop()!.replace(/RingDance|Ring|\.yaml/g, '') || 'Normal', difficultyRank: 3, ciphermapFilename: p.chartPath, eventmapFilename: p.eventPath, noteJumpMovementSpeed: 10, ringNoteJumpMovementSpeed: 10 });
    updateMetadata(p);
  }
}
export class History {
  private past: string[] = []; private future: string[] = [];
  push(p: Project) { this.past.push(JSON.stringify(p)); if (this.past.length > 100) this.past.shift(); this.future = []; }
  undo(p: Project): Project | undefined { const s = this.past.pop(); if (!s) return; this.future.push(JSON.stringify(p)); return JSON.parse(s); }
  redo(p: Project): Project | undefined { const s = this.future.pop(); if (!s) return; this.past.push(JSON.stringify(p)); return JSON.parse(s); }
  checkpoint() { return { past: [...this.past], future: [...this.future] }; }
  restore(checkpoint: { past: string[]; future: string[] }) { this.past = [...checkpoint.past]; this.future = [...checkpoint.future]; }
  clear() { this.past = []; this.future = []; }
}
