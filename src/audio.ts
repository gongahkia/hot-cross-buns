/** Locally synthesized white + pink + brown noise. No audio files or network requests. */
export class FocusSound {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private generation = 0;

  async start(volume: number) {
    const generation = ++this.generation;
    if (!this.context) this.context = new AudioContext();
    // resume is invoked directly from a user gesture, before any fetch.
    await this.context.resume();
    if (generation !== this.generation) return;
    if (this.source) { this.setVolume(volume); return; }
    const context = this.context;
    const size = context.sampleRate * 12;
    const buffer = context.createBuffer(2, size, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let brown = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < size; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
        data[i] = white * 0.12 + pink * 0.32 + brown * 3.5 * 0.56;
      }
      // Blend the loop boundary to avoid a repeating click.
      const fade = Math.floor(context.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const mix = i / fade;
        data[size - fade + i] = data[size - fade + i] * (1 - mix) + data[i] * mix;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0.05;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 5500;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.35);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    this.source = source;
    this.gain = gain;
  }

  setVolume(value: number) {
    if (this.gain && this.context) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.1);
  }

  stop() {
    ++this.generation;
    if (this.source && this.context && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.06);
      this.source.stop(this.context.currentTime + 0.3);
      this.source = null;
      this.gain = null;
    }
  }

  dispose() { this.stop(); void this.context?.close(); this.context = null; }
}
