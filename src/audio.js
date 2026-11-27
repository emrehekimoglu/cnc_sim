// Procedural machine sound: spindle whine + cutting noise + servo hum.
export class MachineAudio {
  constructor() { this.ctx = null; this.enabled = false; }

  _init() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);

    // spindle: two detuned oscillators through a lowpass
    this.spLP = ctx.createBiquadFilter(); this.spLP.type = 'lowpass'; this.spLP.frequency.value = 1800; this.spLP.Q.value = 0.7;
    this.spGain = ctx.createGain(); this.spGain.gain.value = 0;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'triangle';
    this.osc1.connect(this.spLP); this.osc2.connect(this.spLP);
    this.spLP.connect(this.spGain); this.spGain.connect(this.master);
    this.osc1.start(); this.osc2.start();

    // noise source for cutting + coolant
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2; }
    const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    this.cutBP = ctx.createBiquadFilter(); this.cutBP.type = 'bandpass'; this.cutBP.frequency.value = 2200; this.cutBP.Q.value = 1.4;
    this.cutGain = ctx.createGain(); this.cutGain.gain.value = 0;
    mkNoise().connect(this.cutBP); this.cutBP.connect(this.cutGain); this.cutGain.connect(this.master);
    // tooth-passing modulation
    this.toothLFO = ctx.createOscillator(); this.toothLFO.type = 'square';
    this.toothDepth = ctx.createGain(); this.toothDepth.gain.value = 0;
    this.toothLFO.connect(this.toothDepth); this.toothDepth.connect(this.cutGain.gain); this.toothLFO.start();

    this.coolLP = ctx.createBiquadFilter(); this.coolLP.type = 'highpass'; this.coolLP.frequency.value = 3500;
    this.coolGain = ctx.createGain(); this.coolGain.gain.value = 0;
    mkNoise().connect(this.coolLP); this.coolLP.connect(this.coolGain); this.coolGain.connect(this.master);

    this.servo = ctx.createOscillator(); this.servo.type = 'sine'; this.servo.frequency.value = 120;
    this.servoGain = ctx.createGain(); this.servoGain.gain.value = 0;
    this.servo.connect(this.servoGain); this.servoGain.connect(this.master); this.servo.start();
  }

  setEnabled(on) {
    if (on && !this.ctx) this._init();
    this.enabled = on;
    if (this.ctx) {
      if (on) this.ctx.resume();
      this.master.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, 0.1);
    }
  }

  update({ rpm, load, coolant, rapid, flutes }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, k = 0.06;
    const f = Math.max(20, rpm / 60);
    this.osc1.frequency.setTargetAtTime(f * 2, t, k);
    this.osc2.frequency.setTargetAtTime(f * 3.01, t, k);
    this.spLP.frequency.setTargetAtTime(600 + rpm * 0.18, t, k);
    this.spGain.gain.setTargetAtTime(rpm > 10 ? 0.05 + Math.min(rpm, 15000) / 15000 * 0.06 : 0, t, 0.15);
    const l = Math.min(1.2, load);
    this.cutGain.gain.setTargetAtTime(l * 0.22, t, 0.05);
    this.cutBP.frequency.setTargetAtTime(1400 + rpm * 0.15, t, k);
    this.toothLFO.frequency.setTargetAtTime(Math.max(1, f * (flutes || 3)), t, k);
    this.toothDepth.gain.setTargetAtTime(l * 0.1, t, 0.05);
    this.coolGain.gain.setTargetAtTime(coolant * 0.05, t, 0.2);
    this.servoGain.gain.setTargetAtTime(rapid ? 0.03 : 0.0, t, 0.08);
    this.servo.frequency.setTargetAtTime(rapid ? 180 : 120, t, 0.1);
  }
}
