import { createExtractorFromData } from 'node-unrar-js/esm/index.esm.js';
import wasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url';
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const response = await fetch(wasmUrl); if (!response.ok) throw new Error('RAR 解压组件下载失败');
    const extractor = await createExtractorFromData({ data: event.data, wasmBinary: await response.arrayBuffer() });
    const list = extractor.getFileList(), headers = [...list.fileHeaders];
    if (list.arcHeader.flags.volume) throw new Error('暂不支持分卷 RAR，请合并后导入');
    if (list.arcHeader.flags.headerEncrypted || headers.some(h => h.flags.encrypted)) throw new Error('暂不支持加密 RAR，请解密后导入');
    if (headers.length > 3000) throw new Error('压缩包文件数量超过 3000');
    if (headers.reduce((sum, h) => sum + h.unpSize, 0) > 200_000_000) throw new Error('解压内容超过 200MB');
    const names = new Map<string, string>();
    for (const h of headers.filter(h => !h.flags.directory)) {
      const name = h.name.replaceAll('\\', '/');
      if (name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || /[\x00-\x1f:]/.test(p))) throw new Error('压缩包包含不安全路径');
      if (name.split('/').some(p => p === '.ringmapper-backups' || p === '__MACOSX')) continue;
      if ([...names.values()].includes(name)) throw new Error('压缩包包含重复路径');
      names.set(h.name, name);
    }
    const files: [string, Blob][] = [];
    // Exhaust the generator to release the native archive object.
    for (const entry of extractor.extract({ files: h => names.has(h.name) }).files) {
      if (entry.extraction) files.push([names.get(entry.fileHeader.name)!, new Blob([new Uint8Array(entry.extraction)])]);
    }
    self.postMessage({ files });
  } catch (e: any) {
    const message = e.reason === 'ERAR_MISSING_PASSWORD' || e.reason === 'ERAR_BAD_PASSWORD' ? '暂不支持加密 RAR，请解密后导入' : e.reason ? 'RAR 文件损坏或格式不支持（' + e.reason + '）' : e.message;
    self.postMessage({ error: message });
  }
};
