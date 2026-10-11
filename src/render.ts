import { handLane, handPositions } from './layout';
import { items, kinds, type Kind, type Project, type Item } from './model';
export type Selection = { kind: Kind; index: number };
export type ViewState = { project: Project; beat: number; start: number; scale: number; division: number; selected?: Selection; selections?: Selection[]; active: Kind; tool: string; ringRotation: number; ringReverse: boolean };
const colors: Record<Kind, string> = { ringNotes: '#76dfca', notes: '#8dacf9', obstacles: '#d4a86b', events: '#b79beb' };
export const eventTypes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 101];
export const bands: Record<Kind, { top: number; height: number; lanes: number }> = { notes: { top: 42, height: 144, lanes: 10 }, ringNotes: { top: 205, height: 84, lanes: 36 }, obstacles: { top: 308, height: 44, lanes: 4 }, events: { top: 371, height: 90, lanes: 15 } };
export const timelineMargin = 86;
export const timelineHeight = 524;
export function setupCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
export function timelineLane(kind: Kind, n: Item) { return kind === 'notes' ? handLane(n.lineIndex, n.lineLayer) : kind === 'events' ? Math.max(0, eventTypes.indexOf(n.type)) : n.lineIndex; }
export function timelineHit(x: number, y: number, s: ViewState): { kind: Kind; index?: number; lane: number; time: number } | undefined {
  const kind = kinds.find(k => y >= bands[k].top && y <= bands[k].top + bands[k].height);
  if (!kind || x < timelineMargin) return;
  const band = bands[kind], row = Math.min(band.lanes - 1, Math.floor((y - band.top) / band.height * band.lanes));
  const time = s.start + (x - timelineMargin) / s.scale;
  const list = items(s.project, kind);
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i]; if (timelineLane(kind, n) < 0) continue; const ny = band.top + (timelineLane(kind, n) + .5) / band.lanes * band.height;
    const nx = timelineMargin + (n.time - s.start) * s.scale;
    const width = Math.max(9, (n.duration ?? 0) * s.scale);
    if (Math.abs(y - ny) <= Math.max(5, band.height / band.lanes / 2) && x >= nx - 5 && x <= nx + width) return { kind, index: i, lane: row, time };
  }
  return { kind, lane: row, time };
}
export function drawTimeline(canvas: HTMLCanvasElement, s: ViewState, waveform: number[] = []) {
  const { ctx, w, h: actualHeight } = setupCanvas(canvas);
  const h = timelineHeight, verticalScale = actualHeight / timelineHeight;
  ctx.scale(1, verticalScale);
  // Compress the tracks with the dock, but keep text at readable screen-pixel sizes.
  const text = (value: string, x: number, y: number) => {
    ctx.save(); ctx.scale(1, 1 / verticalScale); ctx.fillText(value, x, y * verticalScale); ctx.restore();
  };
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillStyle = '#11161b'; ctx.fillRect(0, 0, w, h);
  const end = s.start + (w - timelineMargin) / s.scale;
  for (const kind of kinds) {
    const b = bands[kind]; ctx.fillStyle = s.active === kind ? '#19232a' : '#161c22'; ctx.fillRect(timelineMargin, b.top, w - timelineMargin, b.height);
    ctx.fillStyle = colors[kind]; text({ ringNotes: '脚部', notes: '手部圆环', obstacles: '障碍物', events: '事件' }[kind], 16, b.top + 16);
    ctx.fillStyle = '#677781'; if (verticalScale >= .48) text(String(items(s.project, kind).length).padStart(3, '0'), 16, b.top + 32);
    const rowCount = kind === 'ringNotes' ? 12 : kind === 'notes' ? 10 : kind === 'obstacles' ? 4 : 15;
    for (let r = 1; r < rowCount; r++) { ctx.strokeStyle = '#273038'; ctx.beginPath(); const y = b.top + r / rowCount * b.height; ctx.moveTo(timelineMargin, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  ctx.fillStyle = '#7b939b'; ctx.font = `${Math.max(6, Math.min(9, bands.notes.height / 10 * verticalScale))}px monospace`;
  handPositions.forEach(([col, layer], i) => text(`${col},${layer}`, 62, bands.notes.top + (i + .5) / 10 * bands.notes.height + 3));
  ctx.font = '10px monospace';
  ctx.save(); ctx.beginPath(); ctx.rect(timelineMargin, 0, w - timelineMargin, h); ctx.clip();
  const step = s.scale / s.division >= 9 ? 1 / s.division : s.scale >= 10 ? 1 : 4;
  for (let b = Math.ceil(s.start / step) * step; b <= end; b += step) {
    const x = timelineMargin + (b - s.start) * s.scale, major = Math.abs(b % 4) < .0001;
    ctx.strokeStyle = major ? '#3b464f' : '#242d35'; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, 465); ctx.stroke();
    if (Number.isInteger(b) && (s.scale >= 24 || major)) { ctx.fillStyle = major ? '#b6c5ce' : '#667985'; text(`${b.toFixed(0)}`, x + 4, 20); }
  }
  for (const kind of kinds) {
    const b = bands[kind];
    items(s.project, kind).forEach((n, i) => {
      if (n.time + Number(n.duration ?? 0) < s.start - 1 || n.time > end + 1) return;
      if (timelineLane(kind, n) < 0) return;
      const x = timelineMargin + (n.time - s.start) * s.scale, y = b.top + (timelineLane(kind, n) + .5) / b.lanes * b.height;
      const height = kind === 'events' ? 5 : kind === 'ringNotes' ? 6 : 7;
      const selected = s.selections?.some(ref => ref.kind === kind && ref.index === i) ?? (s.selected?.kind === kind && s.selected.index === i);
      ctx.fillStyle = selected ? '#ffffff' : (kind === 'notes' || kind === 'ringNotes') ? (n.type === 0 ? '#f197b1' : n.type === 3 ? '#b79beb' : '#8dacf9') : colors[kind];
      ctx.globalAlpha = kind === 'obstacles' ? .6 : .9;
      rounded(ctx, x - 3, y - height / 2, Math.max(7, (n.duration ?? 0) * s.scale), height, 2); ctx.fill(); ctx.globalAlpha = 1;
      if (selected) { ctx.strokeStyle = '#fff'; ctx.strokeRect(x - 6, y - height / 2 - 3, Math.max(13, (n.duration ?? 0) * s.scale + 6), height + 6); }
    });
  }
  if (waveform.length) {
    const duration = Number(s.project.info.songDuration) || 120;
    ctx.fillStyle = '#41615d';
    for (let x = timelineMargin; x < w; x += 3) {
      const beat = s.start + (x - timelineMargin) / s.scale, second = beat * 60 / s.project.info.beatsPerMinute + Number(s.project.info.songTimeOffset || 0);
      const a = waveform[Math.floor(second / duration * waveform.length)] ?? 0; ctx.fillRect(x, 499 - a * 15, 2, Math.max(1, a * 30));
    }
  } else { ctx.fillStyle = '#43515b'; text('加载音频后显示波形', timelineMargin + 12, 500); }
  const cursor = timelineMargin + (s.beat - s.start) * s.scale;
  ctx.strokeStyle = '#a9f2d9'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cursor, 27); ctx.lineTo(cursor, h); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#a9f2d9'; ctx.beginPath(); ctx.moveTo(cursor - 5, 25); ctx.lineTo(cursor + 5, 25); ctx.lineTo(cursor, 32); ctx.fill();
  for (const mark of s.project.chart.customData?.bookmarks ?? []) { const x = timelineMargin + (mark.time - s.start) * s.scale; ctx.fillStyle = '#d4a86b'; text(`⚑ ${mark.name}`, x + 4, 480); }
  ctx.restore();
}
