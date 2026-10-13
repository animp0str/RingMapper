import { readArchive } from './archives';
import { songFromArchive } from './song-import';
export const exampleId = 'diabolic-swing';
let cached: ReturnType<typeof songFromArchive> | undefined;
export function exampleSong() {
  return cached ??= (async () => {
    const response = await fetch('/examples/diabolic-swing/song.zip');
    if (!response.ok) throw new Error('示例谱面加载失败，请刷新重试');
    return songFromArchive(await readArchive(new File([await response.blob()], 'example.zip')));
  })().catch(error => { cached = undefined; throw error; });
}
export async function exampleAssets(id?: string) {
  return id === exampleId ? (await exampleSong()).assets : new Map<string, Blob>();
}
