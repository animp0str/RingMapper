import { decodeText, newProject, readYaml, validateChart } from './model';
export const blobYaml = async (blob: Blob) => readYaml(decodeText(new Uint8Array(await blob.arrayBuffer())));
export async function songFromArchive(files: Map<string, Blob>) {
  const infoNames = [...files.keys()].filter(n => /(^|\/)Info\.yaml$/i.test(n));
  if (infoNames.length !== 1) throw new Error(infoNames.length ? '压缩包包含多首歌曲，请逐首导入' : '压缩包中缺少 Info.yaml');
  const infoName = infoNames[0], prefix = infoName.slice(0, -'Info.yaml'.length);
  const assets = new Map([...files].filter(([n]) => n.startsWith(prefix)).map(([n, blob]) => [n.slice(prefix.length), blob]));
  assets.delete(infoName.slice(prefix.length)); assets.set('Info.yaml', files.get(infoName)!);
  const project = newProject(); project.info = await blobYaml(assets.get('Info.yaml')!);
  const entries = [...(project.info.difficultyCiphermapSets ?? []), ...(project.info.difficultyBeatmapSets ?? [])].flatMap((set: any) => set.difficultyCiphermaps ?? set.difficultyBeatmaps ?? []);
  const events = new Set(entries.map((entry: any) => String(entry.eventmapFilename ?? '').replaceAll('\\', '/')));
  const charts = [...assets.keys()].filter(n => /\.ya?ml$/i.test(n) && n !== 'Info.yaml' && !events.has(n) && !/Event\.ya?ml$/i.test(n));
  if (!charts.length) throw new Error('压缩包中没有谱面文件');
  project.chartPath = charts.find(n => /Normal/.test(n)) ?? charts[0];
  const entry = entries.find((entry: any) => String(entry.ciphermapFilename ?? entry.beatmapFilename ?? '').replaceAll('\\', '/') === project.chartPath);
  project.eventPath = String(entry?.eventmapFilename ?? project.chartPath.replace(/\.ya?ml$/i, 'Event.yaml')).replaceAll('\\', '/');
  project.chart = await blobYaml(assets.get(project.chartPath)!);
  project.event = assets.has(project.eventPath) ? await blobYaml(assets.get(project.eventPath)!) : { version: project.chart.version, events: [] };
  const errors = validateChart(project.chart, project.event); if (errors.length) throw new Error(errors.slice(0, 3).join('；'));
  if (!(Number(project.info.beatsPerMinute) > 0)) throw new Error('Info.yaml 的 BPM 必须大于 0');
  return { project, assets };
}
