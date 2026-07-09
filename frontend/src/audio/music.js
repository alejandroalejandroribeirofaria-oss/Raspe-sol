export class AmbientMusic {
  constructor(context, destination) {
    this.context = context;
    this.destination = destination;
    this.nodes = [];
    this.timer = null;
    this.step = 0;
  }

  start() {
    if (this.timer) return;

    const bass = this.context.createOscillator();
    const bassGain = this.context.createGain();
    bass.type = 'sine';
    bass.frequency.value = 55;
    bassGain.gain.value = 0.035;
    bass.connect(bassGain);
    bassGain.connect(this.destination);
    bass.start();

    const pad = this.context.createOscillator();
    const padGain = this.context.createGain();
    const padFilter = this.context.createBiquadFilter();
    pad.type = 'triangle';
    pad.frequency.value = 110;
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 620;
    padGain.gain.value = 0.025;
    pad.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(this.destination);
    pad.start();

    this.nodes.push(bass, bassGain, pad, padGain, padFilter);
    this.timer = window.setInterval(() => this.playPulse(), 900);
  }

  playPulse() {
    const notes = [220, 277.18, 329.63, 415.3, 554.37, 659.25];
    const frequency = notes[this.step % notes.length];
    this.step += 1;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const delay = this.context.createDelay();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.022, this.context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.55);
    delay.delayTime.value = 0.18;
    oscillator.connect(gain);
    gain.connect(this.destination);
    gain.connect(delay);
    delay.connect(this.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.62);
  }

  stop() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.nodes.forEach((node) => {
      try {
        if (typeof node.stop === 'function') node.stop();
        node.disconnect?.();
      } catch {
        // noop
      }
    });
    this.nodes = [];
  }
}
