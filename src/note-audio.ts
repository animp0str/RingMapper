import { items, type Project } from './model';
export type HitEvent = { beat: number; foot: boolean };
export function hitEvents(project: Project): HitEvent[] {
  const unique = new Map<string, HitEvent>();
  for (const kind of ['notes', 'ringNotes'] as const) for (const n of items(project, kind)) {
    if (kind === 'notes' && n.type === 3) continue;
    if (Number.isFinite(n.time)) unique.set(`${kind}:${n.time}`, { beat: n.time, foot: kind === 'ringNotes' });
  }
  return [...unique.values()].sort((a, b) => a.beat - b.beat);
}
/** Schedule short clicks on the audio clock, independent of rendering frame rate. */
export class NoteAudio {
  enabled = false;
  volume = .5;
  private request = 0;
  private timer?: ReturnType<typeof setInterval>;
  private voices = new Set<OscillatorNode>();
  private gain?: GainNode;
  constructor(private context: () => AudioContext) {}
  setVolume(value: number) { this.volume = Math.max(0, Math.min(1, value)); if (this.gain) this.gain.gain.value = this.volume; }
  stop() {
    ++this.request; clearInterval(this.timer); this.timer = undefined;
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear();
  }
  async start(project: Project, clock: () => { beat: number; beatsPerSecond: number }) {
    this.stop(); if (!this.enabled) return;
    const request = this.request, context = this.context(), initial = clock().beat;
    try { await context.resume(); } catch { return; }
    if (request !== this.request || !this.enabled) return;
    this.gain ??= context.createGain(); this.gain.gain.value = this.volume;
    this.gain.disconnect(); this.gain.connect(context.destination);
    const events = hitEvents(project); let next = events.findIndex(n => n.beat >= initial - 1e-7);
    if (next < 0) return;
    const tick = () => {
      const position = clock(), horizon = position.beat + .12 * position.beatsPerSecond;
      while (next < events.length && events[next].beat <= horizon) {
        const event = events[next++], seconds = (event.beat - position.beat) / position.beatsPerSecond;
        if (seconds < -.06) continue; // Never burst old notes after a suspended tab.
        const at = context.currentTime + Math.max(0, seconds), voice = context.createOscillator(), envelope = context.createGain();
        voice.type = 'triangle'; voice.frequency.setValueAtTime(event.foot ? 480 : 1800, at);
        envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(.9, at + .002); envelope.gain.setValueAtTime(.9, at + .014); envelope.gain.exponentialRampToValueAtTime(.0001, at + .085);
        voice.connect(envelope); envelope.connect(this.gain!); this.voices.add(voice);
        voice.onended = () => { voice.disconnect(); envelope.disconnect(); this.voices.delete(voice); };
        voice.start(at); voice.stop(at + .09);
      }
    };
    tick(); this.timer = setInterval(tick, 25);
  }
}
