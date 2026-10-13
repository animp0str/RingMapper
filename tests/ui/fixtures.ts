import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
export { expect, type Page };
let fixtureFiles: { name: string; data: string }[] | undefined;
async function files() {
  if (fixtureFiles) return fixtureFiles;
  const result: { name: string; data: string }[] = [];
  async function walk(relative: string) { for (const item of await fs.readdir(path.join('Map', relative), { withFileTypes: true })) { const name = `${relative}/${item.name}`; if (item.isDirectory()) await walk(name); else result.push({ name, data: (await fs.readFile(path.join('Map', name))).toString('base64') }); } }
  await walk('caocao'); await walk('3n3rgizer'); fixtureFiles = result; return result;
}
/** Each browser context owns a real, isolated OPFS directory; repository songs are read-only fixtures. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/__fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated workspace setup</title>' }));
    await page.goto('/__fixture__');
    await page.evaluate(async files => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Map', { create: true });
      for (const { name, data } of files) {
        const parts = name.split('/'), file = parts.pop()!; let dir = root;
        for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
        const writer = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await writer.write(Uint8Array.from(atob(data), c => c.charCodeAt(0))); await writer.close();
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('ringmapper-local', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => { const t = db.transaction('state', 'readwrite'); t.objectStore('state').put({ id: 'fixture-map', handle: root }, 'workspace'); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); }); db.close();
    }, await files());
    await page.addInitScript(() => { (window as any).showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Map'); });
    await use(page);
  }
});
export async function fixtureFile(page: Page, name: string, write?: string) {
  return page.evaluate(async ({ name, write }) => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Map');
    const parts = name.split('/'), file = parts.pop()!;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(file);
    if (write !== undefined) { const writer = await handle.createWritable(); await writer.write(write); await writer.close(); }
    return (await handle.getFile()).text();
  }, { name, write });
}
