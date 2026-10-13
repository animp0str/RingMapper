import JSZip from 'jszip';
export const archiveLimit = 200_000_000;
export const archiveFileLimit = 3000;
export const isArchive = (name: string) => /\.(zip|rar)$/i.test(name);
export function archivePath(name: string) {
  const path = name.replaceAll('\\', '/');
  if (path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f:]/.test(p))) throw new Error('压缩包包含不安全路径');
  return path;
}
export function ignoredArchivePath(name: string) { return name.split('/').some(p => p === '.ringmapper-backups' || p === '__MACOSX'); }
export async function readArchive(file: File): Promise<Map<string, Blob>> {
  if (file.size > archiveLimit) throw new Error('压缩包超过 200MB');
  if (/\.rar$/i.test(file.name)) {
    const data = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./rar-worker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('RAR 解压超时，请检查压缩包')); }, 60_000);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      worker.onmessage = event => { finish(); if (event.data.error) reject(new Error(event.data.error)); else resolve(new Map(event.data.files)); };
      worker.onerror = () => { finish(); reject(new Error('RAR 解压组件加载失败，请刷新网页重试')); };
      worker.postMessage(data, [data]);
    });
  }
  const zip = await JSZip.loadAsync(file); const entries = Object.values(zip.files).filter(e => !e.dir);
  if (entries.length > archiveFileLimit) throw new Error('压缩包文件数量超过 3000');
  const result = new Map<string, Blob>(); let bytes = 0;
  for (const entry of entries) {
    const name = archivePath((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name);
    if (ignoredArchivePath(name)) continue;
    const blob = await entry.async('blob'); bytes += blob.size;
    if (bytes > archiveLimit) throw new Error('解压内容超过 200MB');
    if (result.has(name)) throw new Error('压缩包包含重复路径');
    result.set(name, blob);
  }
  return result;
}
