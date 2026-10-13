import fs from 'node:fs/promises';
import path from 'node:path';
import { type LocalDirectory, type LocalFile } from '../src/workspace';
/** Read-only adapter used solely to verify the browser catalog against the repository corpus. */
export class ReadDirectory implements LocalDirectory {
  readonly kind = 'directory';
  constructor(private directory: string) {}
  get name() { return path.basename(this.directory); }
  private async stat(name: string) { try { return await fs.stat(path.join(this.directory, name)); } catch (e: any) { if (e.code === 'ENOENT') throw new DOMException(name, 'NotFoundError'); throw e; } }
  async *values(): AsyncIterableIterator<LocalDirectory | LocalFile> {
    for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      yield entry.isDirectory() ? new ReadDirectory(path.join(this.directory, entry.name)) : await this.getFileHandle(entry.name);
    }
  }
  async getDirectoryHandle(name: string) { if (!(await this.stat(name)).isDirectory()) throw new DOMException(name, 'TypeMismatchError'); return new ReadDirectory(path.join(this.directory, name)); }
  async getFileHandle(name: string): Promise<LocalFile> {
    if (!(await this.stat(name)).isFile()) throw new DOMException(name, 'TypeMismatchError');
    return { kind: 'file', name, getFile: async () => new File([await fs.readFile(path.join(this.directory, name))], name), createWritable: async () => { throw new Error('Repository fixtures are read-only'); } };
  }
  async removeEntry(): Promise<void> { throw new Error('Repository fixtures are read-only'); }
}
