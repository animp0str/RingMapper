import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readArchive, archivePath } from '../src/archives';
import { songFromArchive } from '../src/song-import';

test('ZIP song import preserves custom event references, assets and unknown YAML fields', async () => {
  const zip = new JSZip().file('song/INFO.YAML', 'songName: Fixture\nbeatsPerMinute: 123\nsongTimeOffset: 0\ncustomField: keep\ndifficultyBeatmapSets:\n  - difficultyBeatmaps:\n      - beatmapFilename: Ring/NormalRing.yaml\n        eventmapFilename: Custom/light.yaml\n');
  zip.file('song/Ring/NormalRing.yaml', 'notes: []\nringNotes: []\nobstacles: []\nunknown: value\n').file('song/Custom/light.yaml', 'events: [{time: 1, type: 101, value: 2}]\n').file('song/song.ogg', 'audio').file('song/.ringmapper-backups/old.yaml', 'old');
  const result = await songFromArchive(await readArchive(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'song.ZIP')));
  assert.equal(result.project.info.customField, 'keep'); assert.equal(result.project.eventPath, 'Custom/light.yaml'); assert.equal(result.project.event.events[0].type, 101); assert.equal(result.project.chart.unknown, 'value'); assert.equal(await result.assets.get('song.ogg')!.text(), 'audio'); assert(![...result.assets.keys()].some(n => n.includes('backups')));
});
test('archive paths reject traversal, roots and alternate streams', () => {
  for (const name of ['../a', '/a', 'C:/a', 'a:b', 'a/../b', 'a//b']) assert.throws(() => archivePath(name));
  assert.equal(archivePath('Ring\\Normal.yaml'), 'Ring/Normal.yaml');
});
test('ZIP sanitized traversal is still rejected and original song is not silently chosen from multi-song archives', async () => {
  const zip = new JSZip().file('../Info.yaml', 'songName: bad');
  await assert.rejects(readArchive(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'bad.zip')), /路径/);
  await assert.rejects(songFromArchive(new Map()), /Info.yaml/);
  await assert.rejects(songFromArchive(new Map([['a/Info.yaml', new Blob()], ['b/Info.yaml', new Blob()]])), /多首歌曲/);
});
