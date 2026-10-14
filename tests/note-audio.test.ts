import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject } from '../src/model';
import { hitEvents, NoteAudio } from '../src/note-audio';

test('sound events exclude mines and deduplicate chords without dropping foot or grouped notes', () => {
  const p = newProject(); p.chart.notes = [{ time: 1, type: 0 }, { time: 1, type: 1 }, { time: .5, type: 3 }, { time: 2, type: 0, groupId: 'x' }]; p.chart.ringNotes = [{ time: 1, duration: 2, ringNoteType: 1 }];
  assert.deepEqual(hitEvents(p), [{ beat: 1, foot: false }, { beat: 1, foot: true }, { beat: 2, foot: false }]);
});
function audioContext(resume = async () => {}) {
  const starts: number[] = [], stops: (number | undefined)[] = [], tones: number[] = [], gains: any[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const context = { currentTime: 5, destination: {}, resume,
    createGain() { const g = { gain: param(), connect() {}, disconnect() {} }; gains.push(g); return g; },
    createOscillator() { return { frequency: { setValueAtTime(f: number) { tones.push(f); } }, connect() {}, disconnect() {}, start(t: number) { starts.push(t); }, stop(t?: number) { stops.push(t); }, onended: undefined }; }
  };
  return { context: context as unknown as AudioContext, starts, stops, tones, gains };
}
test('audio-clock scheduling respects speed, independent volume, and cancellation on pause', async () => {
  const p = newProject(); p.chart.notes = [{ time: 0, type: 0 }, { time: .2, type: 1 }, { time: 5, type: 0 }]; p.chart.ringNotes = [{ time: .1 }];
  const fake = audioContext(), player = new NoteAudio(() => fake.context); player.enabled = true; player.setVolume(.3);
  try {
    await player.start(p, () => ({ beat: 0, beatsPerSecond: 2 }));
    assert.deepEqual(fake.starts, [5, 5.05, 5.1]); assert.deepEqual(fake.tones, [1800, 480, 1800]); assert.equal(fake.gains[0].gain.value, .3);
    player.setVolume(.15); assert.equal(fake.gains[0].gain.value, .15);
  } finally { player.stop(); }
  assert.equal(fake.stops.filter(t => t === undefined).length, 3);
});
test('disabled sound and cancelled AudioContext resume never emit notes', async () => {
  let resolve!: () => void; const fake = audioContext(() => new Promise<void>(r => { resolve = r; })); const p = newProject(); p.chart.notes = [{ time: 0, type: 0 }];
  const player = new NoteAudio(() => fake.context); await player.start(p, () => ({ beat: 0, beatsPerSecond: 2 })); assert.equal(fake.starts.length, 0);
  player.enabled = true; const pending = player.start(p, () => ({ beat: 0, beatsPerSecond: 2 })); player.stop(); resolve(); await pending; assert.equal(fake.starts.length, 0);
});
