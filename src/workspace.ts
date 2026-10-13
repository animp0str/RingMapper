import JSZip from 'jszip';
import { decodeText, readYaml, writeYaml, sortedProject, updateMetadata, validateChart, type Project, type Song, type ChartEntry } from './model';

export interface LocalFile {
  kind: 'file'; name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface LocalDirectory {
  kind: 'directory'; name: string;
  values(): AsyncIterableIterator<LocalDirectory | LocalFile>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFile>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  isSameEntry?(other: LocalDirectory): Promise<boolean>;
}
export type WorkspaceRecord = { id: string; handle: LocalDirectory };
export type Draft = { project: Project; assets: Map<string, Blob>; date: number };
const backupName = '.ringmapper-backups';
const supported = /\.(yaml|yml|ogg|mp3|wav|png|jpg|jpeg|webp)$/i;
export function localPath(path: string): string[] {
  const parts = path.replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f:]/.test(p)) || parts.includes(backupName)) throw new Error('文件路径不合法或指向备份目录');
  return parts;
}
const absent = (e: unknown) => (e as DOMException)?.name === 'NotFoundError';
async function parent(root: LocalDirectory, path: string, create = false) {
  const parts = localPath(path), name = parts.pop()!;
  for (const part of parts) root = await root.getDirectoryHandle(part, { create });
  return { dir: root, name };
}
export async function readFile(root: LocalDirectory, path: string): Promise<File | undefined> {
  try { const { dir, name } = await parent(root, path); return await (await dir.getFileHandle(name)).getFile(); }
  catch (e) { if (absent(e)) return; throw e; }
}
async function writeFile(root: LocalDirectory, path: string, data: Blob | string) {
  const { dir, name } = await parent(root, path, true), handle = await dir.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(data); await writer.close(); } catch (e) { await writer.abort().catch(() => {}); throw e; }
}
async function allFiles(root: LocalDirectory, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for await (const child of root.values()) {
    if (child.name === backupName) continue;
    const path = prefix + child.name;
    if (child.kind === 'directory') files.push(...await allFiles(child, path + '/'));
    else files.push(path);
  }
  return files;
}
const yaml = async (file: Blob) => readYaml(decodeText(new Uint8Array(await file.arrayBuffer())));
async function fingerprint(file?: Blob) {
  if (!file) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
type Revision = { workspace: string; song: string; files: Record<string, string | null> };

/** All chart and media I/O remains within the directory explicitly chosen by the visitor. */
export class LocalWorkspace {
  private saving = false;
  constructor(public readonly record: WorkspaceRecord) {}
  get id() { return this.record.id; }
  get name() { return this.record.handle.name; }
  async permitted(mode: 'read' | 'readwrite', request = false) {
    const handle = this.record.handle;
    if (!handle.queryPermission) return true;
    if (await handle.queryPermission({ mode }) === 'granted') return true;
    return request && await handle.requestPermission?.({ mode }) === 'granted';
  }
  async catalog(): Promise<Song[]> {
    const songs: Song[] = [];
    for await (const dir of this.record.handle.values()) {
      if (dir.kind !== 'directory' || dir.name === backupName) continue;
      try {
        const file = await readFile(dir, 'Info.yaml'); if (!file) continue;
        const info = await yaml(file), files = await allFiles(dir), warnings: string[] = [], references = new Map<string, any>();
        for (const set of [...(info.difficultyCiphermapSets ?? []), ...(info.difficultyBeatmapSets ?? [])]) {
          for (const entry of set.difficultyCiphermaps ?? set.difficultyBeatmaps ?? []) {
            const name = String(entry.ciphermapFilename ?? entry.beatmapFilename ?? '').replaceAll('\\', '/');
            references.set(name, { ...entry, mode: set.ciphermapCharacteristicName ?? set.beatmapCharacteristicName });
            if (!files.includes(name)) warnings.push(`元数据引用不存在：${name}`);
          }
        }
        const eventPaths = new Set([...references.values()].map(ref => String(ref.eventmapFilename ?? '').replaceAll('\\', '/')));
        const charts: ChartEntry[] = files.filter(f => /\.ya?ml$/i.test(f) && f !== 'Info.yaml' && !eventPaths.has(f) && !/Event\.ya?ml$/i.test(f)).map(f => {
          const ref = references.get(f), event = String(ref?.eventmapFilename ?? '').replaceAll('\\', '/');
          return { path: f, mode: ref?.mode ?? f.split('/')[0], difficulty: ref?.difficulty ?? f.split('/').at(-1)!.replace(/RingDance|Ring|\.ya?ml/gi, ''), eventPath: event || f.replace(/\.ya?ml$/i, 'Event.yaml') };
        });
        const order = ['Easy', 'Normal', 'Hard', 'Expert', 'ExpertPlus'];
        charts.sort((a, b) => a.mode.localeCompare(b.mode) || order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
        songs.push({ id: dir.name, name: String(info.songName || dir.name), artist: String(info.songAuthorName || '未知艺术家'), bpm: Number(info.beatsPerMinute) || 120, duration: Number(info.songDuration) || 0, cover: files.includes(info.coverImageFilename) ? info.coverImageFilename : '', audio: files.includes(info.songFilename) ? info.songFilename : files.find(f => /\.(ogg|mp3|wav)$/i.test(f)) ?? '', charts, warnings });
      } catch (e) { if ((e as DOMException).name === 'NotAllowedError') throw e; console.warn(`跳过歌曲 ${dir.name}:`, e); }
    }
    return songs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  private song(id: string, create = false) {
    if (localPath(id).length !== 1) throw new Error('歌曲目录名不能包含路径');
    return this.record.handle.getDirectoryHandle(id, { create });
  }
  async asset(song: string, path: string) { return readFile(await this.song(song), path); }
  async open(song: Song, entry: ChartEntry): Promise<Project> {
    const dir = await this.song(song.id), contents = new Map<string, File>(), files: Revision['files'] = {};
    for (const name of await allFiles(dir)) if (supported.test(name)) { const file = await readFile(dir, name); if (file) { contents.set(name, file); files[name] = await fingerprint(file); } }
    const info = contents.get('Info.yaml'), chart = contents.get(entry.path);
    if (!info || !chart) throw new Error('歌曲信息或谱面已被移除，请刷新曲库');
    const chartData = await yaml(chart), event = contents.get(entry.eventPath);
    return { songId: song.id, workspaceId: this.id, chartPath: entry.path, eventPath: entry.eventPath, info: await yaml(info), chart: chartData, event: event ? await yaml(event) : { version: chartData.version, events: [] }, revision: JSON.stringify({ workspace: this.id, song: song.id, files } satisfies Revision) };
  }
  async export(project: Project, assets: Map<string, Blob>) {
    const p = sortedProject(project), errors = validateChart(p.chart, p.event); if (errors.length) throw new Error(errors[0]); updateMetadata(p);
    const zip = new JSZip();
    if (p.songId) {
      if (p.workspaceId !== this.id) throw new Error('此谱面属于另一个工作区，请重新打开原目录');
      const dir = await this.song(p.songId);
      for (const name of await allFiles(dir)) { const file = await readFile(dir, name); if (file) zip.file(name, await file.arrayBuffer()); }
    }
    for (const [name, blob] of assets) { localPath(name); zip.file(name, await blob.arrayBuffer()); }
    zip.file('Info.yaml', writeYaml(p.info)); zip.file(p.chartPath, writeYaml(p.chart)); zip.file(p.eventPath, writeYaml(p.event));
    return zip;
  }
  async save(project: Project, assets: Map<string, Blob>) {
    // Called directly from a click/keyboard handler so requesting permission retains user activation.
    if (!await this.permitted('readwrite', true)) throw new Error('未获得文件夹写入权限；仍可导出 ZIP');
    if (this.saving) throw new Error('正在保存，请稍后重试');
    this.saving = true;
    try {
      const action = () => this.commit(project, assets);
      return typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request(`ringmapper:${this.id}:${project.songId}`, action) : await action();
    } finally { this.saving = false; }
  }
  private async commit(project: Project, assets: Map<string, Blob>) {
    const p = sortedProject(project), errors = validateChart(p.chart, p.event);
    if (errors.length) throw new Error(errors.slice(0, 5).join('；'));
    if (!(Number(p.info.beatsPerMinute) > 0) || !Number.isFinite(Number(p.info.songTimeOffset))) throw new Error('BPM 或偏移不合法');
    if (localPath(p.songId).length !== 1) throw new Error('请输入单个歌曲目录名');
    if (!/\.ya?ml$/i.test(p.chartPath) || !/\.ya?ml$/i.test(p.eventPath) || p.chartPath === p.eventPath || [p.chartPath, p.eventPath].includes('Info.yaml')) throw new Error('谱面与事件需要独立的 YAML 路径');
    if (p.workspaceId && p.workspaceId !== this.id) throw new Error('工作区不匹配，不能覆盖此目录');
    let base: Revision | undefined;
    if (p.revision) { try { base = JSON.parse(p.revision); } catch {} }
    if (base && (base.workspace !== this.id || base.song !== p.songId)) throw new Error('保存版本不属于当前工作区');
    let dir: LocalDirectory | undefined;
    try { dir = await this.song(p.songId); } catch (e) { if (!absent(e)) throw e; }
    if (dir && !base) throw new Error('目录已存在，请重新打开或使用新的歌曲目录名');
    if (!dir && base) throw new Error('原歌曲目录已被移除，请另存为新歌曲');
    updateMetadata(p);
    const writes = new Map(assets);
    writes.set('Info.yaml', new Blob([writeYaml(p.info)])); writes.set(p.chartPath, new Blob([writeYaml(p.chart)])); writes.set(p.eventPath, new Blob([writeYaml(p.event)]));
    const originals = new Map<string, Blob | undefined>();
    for (const [name] of writes) {
      localPath(name); if (!supported.test(name)) throw new Error('资源格式不支持：' + name);
      const file = dir ? await readFile(dir, name) : undefined;
      // Copy original bytes before writing: browser File snapshots can become unreadable after overwrite.
      const original = file ? new Blob([await file.arrayBuffer()]) : undefined;
      if (await fingerprint(original) !== (base?.files[name] ?? null)) throw new Error(`文件已在外部修改或新增：${name}。请重新打开或导出 ZIP 保留当前编辑。`);
      originals.set(name, original);
    }
    let backup = '';
    if (dir) {
      backup = `${backupName}/${p.songId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const backupRoot = await this.record.handle.getDirectoryHandle(backupName, { create: true });
      for (const [name, original] of originals) if (original) await writeFile(backupRoot, backup.slice(backupName.length + 1) + '/' + name, original);
      // Recheck after backups, immediately before modifying user files.
      for (const [name, original] of originals) if (await fingerprint(await readFile(dir, name)) !== await fingerprint(original)) throw new Error('备份期间文件发生修改，已停止保存：' + name);
    }
    dir ??= await this.song(p.songId, true);
    const attempted: string[] = [];
    try {
      for (const [name, data] of writes) { attempted.push(name); await writeFile(dir, name, data); }
    } catch (e) {
      const failed: string[] = [];
      for (const name of attempted.reverse()) {
        try { const original = originals.get(name); if (original) await writeFile(dir, name, original); else { const target = await parent(dir, name); await target.dir.removeEntry(target.name).catch(error => { if (!absent(error)) throw error; }); } }
        catch { failed.push(name); }
      }
      throw new Error(`保存失败：${(e as Error).message}。${failed.length ? `以下文件恢复失败：${failed.join('、')}；原文件备份位于 ${backup || '无原文件'}。请导出 ZIP 保留编辑。` : '已恢复本次改动，编辑内容仍保留，请重试或导出 ZIP。'}`);
    }
    const files = { ...base?.files };
    for (const [name, data] of writes) files[name] = await fingerprint(data);
    return { revision: JSON.stringify({ workspace: this.id, song: p.songId, files } satisfies Revision), backup, info: p.info };
  }
}

export async function stored<T>(key: string, ...value: [T] | []): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('ringmapper-local', 1); request.onupgradeneeded = () => request.result.createObjectStore('state'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction('state', value.length ? 'readwrite' : 'readonly'), store = tx.objectStore('state');
      const request = value.length ? store.put(value[0], key) : store.get(key);
      tx.oncomplete = () => resolve(value.length ? value[0] : request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export function directorySupported() { return typeof (window as any).showDirectoryPicker === 'function'; }
export async function chooseWorkspace(previous?: WorkspaceRecord): Promise<WorkspaceRecord> {
  const handle: LocalDirectory = await (window as any).showDirectoryPicker({ id: 'ringmapper-map', mode: 'read', startIn: previous?.handle });
  const known = await stored<WorkspaceRecord[]>('workspaces').catch(() => undefined) ?? [];
  let match: WorkspaceRecord | undefined;
  for (const entry of [...(previous ? [previous] : []), ...known]) {
    try { if (await handle.isSameEntry?.(entry.handle)) { match = entry; break; } } catch {}
  }
  const record = { id: match?.id ?? crypto.randomUUID(), handle };
  const registry = new Map([...known, ...(previous ? [previous] : []), record].map(entry => [entry.id, entry]));
  await stored('workspaces', [...registry.values()]).catch(() => {});
  return record;
}
