import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalWorkspace, localPath, type LocalDirectory, type LocalFile } from '../src/workspace.ts';
import { newProject, writeYaml, readYaml } from '../src/model.ts';

class MemoryDirectory implements LocalDirectory {
  readonly kind = 'directory';
  entries = new Map<string, MemoryDirectory | MemoryFile>();
  fault: (path: string) => boolean = () => false;
  constructor(public name = 'Map', readonly prefix = '', readonly root?: MemoryDirectory) {}
  async *values() { yield* this.entries.values(); }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    let entry = this.entries.get(name); if (!entry && options?.create) { entry = new MemoryDirectory(name, this.prefix + name + '/', this.root ?? this); this.entries.set(name, entry); }
    if (!entry) throw new DOMException(name, 'NotFoundError'); if (entry.kind !== 'directory') throw new DOMException(name, 'TypeMismatchError'); return entry;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    let entry = this.entries.get(name); if (!entry && options?.create) { entry = new MemoryFile(name, this.prefix + name, this.root ?? this); this.entries.set(name, entry); }
    if (!entry) throw new DOMException(name, 'NotFoundError'); if (entry.kind !== 'file') throw new DOMException(name, 'TypeMismatchError'); return entry;
  }
  async removeEntry(name: string) { this.entries.delete(name); }
  async set(path: string, value: string) { const parts = path.split('/'), file = parts.pop()!; let dir: MemoryDirectory = this; for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true }); (await dir.getFileHandle(file, { create: true })).content = value; }
  async get(path: string): Promise<string> { const parts = path.split('/'), file = parts.pop()!; let dir: MemoryDirectory = this; for (const part of parts) dir = await dir.getDirectoryHandle(part); return (await dir.getFileHandle(file)).content; }
}
class MemoryFile implements LocalFile {
  readonly kind = 'file'; content = '';
  constructor(public name: string, private path: string, private root: MemoryDirectory) {}
  async getFile() { return new File([this.content], this.name); }
  async createWritable() {
    let value = '';
    return { write: async (data: Blob | string) => { value = typeof data === 'string' ? data : await data.text(); }, close: async () => { if (this.root.fault(this.path)) throw new Error('injected write failure'); this.content = value; }, abort: async () => {} };
  }
}
async function fixture() {
  const root = new MemoryDirectory(), ws = new LocalWorkspace({ id: 'A', handle: root }), p = newProject(); p.songId = 'song';
  p.chart.notes = [{ time: 1, lineIndex: 0, lineLayer: 0, type: 1, custom: 'retain' }]; p.event.events = [{ time: 1, type: 101, value: 2 }];
  await ws.save(p, new Map([['song.ogg', new Blob(['old audio'])], ['cover.png', new Blob(['old cover'])], ['Ring/HardRing.yaml', new Blob([writeYaml(newProject().chart)])]]));
  const song = (await ws.catalog())[0]; const project = await ws.open(song, song.charts.find(c => c.difficulty === 'Normal')!);
  return { root, ws, project };
}
test('browser paths reject traversal, streams, roots and backup destinations', () => {
  assert.deepEqual(localPath('song\\Ring\\Easy.yaml'), ['song','Ring','Easy.yaml']);
  for (const path of ['../x', '/x', 'x/../y', 'C:\\a', 'x:stream', 'x//y', 'x\0y', '.ringmapper-backups/x']) assert.throws(() => localPath(path));
});
test('browser workspace scans actual files, ignores backups, preserves native fields and exports all assets', async () => {
  const { root, ws, project } = await fixture();
  await root.set('song/extra.txt', 'untouched extension'); project.chart.notes![0].time = 2;
  const result = await ws.save(project, new Map([['song.ogg', new Blob(['new audio'])]]));
  assert.ok(result.backup.startsWith('.ringmapper-backups/song/'));
  assert.equal(await root.get(result.backup + '/song.ogg'), 'old audio');
  assert.equal(readYaml(await root.get('song/Ring/NormalRing.yaml')).notes[0].custom, 'retain');
  assert.equal((await ws.catalog()).length, 1);
  const zip = await ws.export(project, new Map());
  for (const name of ['song.ogg', 'cover.png', 'Ring/HardRing.yaml', 'extra.txt']) assert.ok(zip.file(name));
  assert.equal(Object.keys(zip.files).some(k => k.includes('.ringmapper-backups')), false);
});
test('save detects external edits to every overwritten asset and to staged other difficulties', async () => {
  for (const target of ['Info.yaml', 'Ring/NormalRing.yaml', 'song.ogg', 'cover.png', 'Ring/HardRing.yaml']) {
    const { root, ws, project } = await fixture(); await root.set('song/' + target, 'external');
    await assert.rejects(ws.save(project, new Map([[target, new Blob(['replacement'])]])), /外部修改/);
    assert.equal(await root.get('song/' + target), 'external');
  }
});
test('new difficulty refuses a same-name file added since the original snapshot', async () => {
  const { root, ws, project } = await fixture(); project.chartPath = 'Ring/ExpertRing.yaml'; project.eventPath = 'Ring/ExpertRingEvent.yaml';
  await root.set('song/' + project.chartPath, 'external'); await assert.rejects(ws.save(project, new Map()), /外部修改/);
});
test('backup failure does not write originals; partial write failure restores originals', async () => {
  const { root, ws, project } = await fixture(); const original = await root.get('song/Info.yaml'); project.info.songName = 'changed';
  root.fault = path => path.startsWith('.ringmapper-backups/'); await assert.rejects(ws.save(project, new Map()), /injected/); assert.equal(await root.get('song/Info.yaml'), original);
  let once = true; root.fault = path => path === 'song/Ring/NormalRing.yaml' && once && (once = false, true);
  await assert.rejects(ws.save(project, new Map()), /已恢复/); assert.equal(await root.get('song/Info.yaml'), original);
  root.fault = () => false; await ws.save(project, new Map()); assert.equal(readYaml(await root.get('song/Info.yaml')).songName, 'changed');
});
test('failed rollback identifies backup and keeps conflicting workspace from writing', async () => {
  const { root, ws, project } = await fixture(); root.fault = path => path === 'song/Ring/NormalRing.yaml';
  await assert.rejects(ws.save(project, new Map()), /恢复失败.*备份/);
  project.workspaceId = 'B'; await assert.rejects(ws.save(project, new Map()), /工作区不匹配/);
});
test('permission denial leaves local files unchanged; existing directories cannot be overwritten by a new song', async () => {
  const { root, project } = await fixture(); const denied = Object.assign(root, { queryPermission: async () => 'denied' as const, requestPermission: async () => 'denied' as const });
  await assert.rejects(new LocalWorkspace({ id: 'A', handle: denied }).save(project, new Map()), /写入权限/);
  delete (root as any).queryPermission; delete (root as any).requestPermission;
  const ws = new LocalWorkspace({ id: 'A', handle: root }); const fresh = newProject(); fresh.songId = 'song'; await assert.rejects(ws.save(fresh, new Map()), /目录已存在/);
});
