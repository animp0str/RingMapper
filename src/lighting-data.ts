import type { Item } from './model';
export type LightTrack = { key: string; name: string; type: number; speed: boolean };
// Native consecutive pairs are inferred from local maps; the mapping is user-calibratable.
export const defaultLightTracks: LightTrack[] = [
  { key: 'left-speed', name: '左侧灯光速度', type: 3, speed: true },
  { key: 'left', name: '左侧灯光', type: 2, speed: false },
  { key: 'right', name: '右侧灯光', type: 4, speed: false },
  { key: 'right-speed', name: '右侧灯光速度', type: 5, speed: true },
  { key: 'main', name: '主灯光', type: 1, speed: false },
  { key: 'rhythm', name: '律动光', type: 6, speed: false },
  { key: 'diamond', name: '菱形灯光', type: 7, speed: false },
  { key: 'diamond-speed', name: '菱形灯光速度', type: 8, speed: true },
  { key: 'stars', name: '星空灯光', type: 9, speed: false },
  { key: 'stars-speed', name: '星空灯光速度', type: 10, speed: true },
];
export const lightValues = ['绿色 · 关闭', '绿色 · 亮起', '绿色 · 渐入 / 闪烁', '绿色 · 渐出', '黄色 · 关闭', '黄色 · 亮起', '黄色 · 渐入 / 闪烁', '黄色 · 渐出'];
export function lightColor(value: number) { return value === 0 || value === 4 ? '#506461' : value >= 5 ? '#ffd875' : '#66efb1'; }
export function lightTracks(events: Item[], mapping: LightTrack[]) {
  const known = new Set(mapping.map(t => t.type));
  return [...mapping, ...[...new Set(events.map(e => e.type))].filter(t => !known.has(t)).sort((a,b) => a-b).map(type => ({ key: `extra-${type}`, name: `扩展 ${type}`, type, speed: false }))];
}
export function validLightMapping(types: number[]) { return types.length === 10 && types.every(t => Number.isInteger(t) && t >= 0) && new Set(types).size === 10; }

/** Schematic local preview, not a claim to reproduce the game's undocumented shader timing. */
export function lightAt(events: Item[], type: number, beat: number) {
  let latest: Item | undefined;
  for (const event of events) if (event.type === type && event.time <= beat && (!latest || event.time >= latest.time)) latest = event;
  if (!latest) return { value: 0, intensity: 0, color: lightColor(0) };
  const age = beat - latest.time, action = latest.value % 4;
  const intensity = action === 0 ? 0 : action === 3 ? Math.max(0, 1 - age) : action === 2 ? .45 + .55 * Math.max(0, 1 - age * 2) : 1;
  return { value: latest.value, intensity, color: lightColor(latest.value) };
}
