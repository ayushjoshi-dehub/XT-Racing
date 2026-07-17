export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOscillators = [];
    this.started = false;
    this.muted = false;

    // Engine realism layers
    this.noise = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.exhaustWaveshaper = null;

    // Wind layer
    this.windNoise = null;
    this.windFilter = null;
    this.windGain = null;

    // Nitro overtone layer
    this.nitroOsc = null;
    this.nitroOsc2 = null;
    this.nitroGain = null;

    // Gear tracking
    this._lastGear = -1;
    this._lastSpeed = 0;
    this._backfireTimer = 0;
    this.bikeType = 'sports';
  }

  start() {
    if (this.started) {
      this.context?.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.context = new AudioContext();

    // ─── Master Compressor (punchier, prevents clipping) ───────────────────
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;

    this.master = this.context.createGain();
    this.master.gain.value = 0.58;

    this.compressor.connect(this.master);
    this.master.connect(this.context.destination);

    // ─── Engine waveshaper & filter ────────────────────────────────────────
    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 3.2;

    this.exhaustWaveshaper = this.context.createWaveShaper();
    this.exhaustWaveshaper.curve = this.makeDistortionCurve(44);

    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0.0001;

    this.exhaustWaveshaper.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.compressor);

    // ─── White noise (air intake & piston friction) ────────────────────────
    const bufferSize = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.noise = this.context.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;

    this.noiseFilter = this.context.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 300;
    this.noiseFilter.Q.value = 4.2;

    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.005;

    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.engineFilter);
    this.noise.start();

    // ─── Wind / air rush layer ─────────────────────────────────────────────
    const windBufSize = this.context.sampleRate * 3;
    const windBuf = this.context.createBuffer(1, windBufSize, this.context.sampleRate);
    const windData = windBuf.getChannelData(0);
    // Pink-ish noise (sum of decreasing amplitudes)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
    for (let i = 0; i < windBufSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      windData[i] = (b0 + b1 + b2 + b3 + b4 + b5) * 0.11;
    }
    this.windNoise = this.context.createBufferSource();
    this.windNoise.buffer = windBuf;
    this.windNoise.loop = true;

    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.8;

    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.0001;

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.compressor);
    this.windNoise.start();

    // ─── Nitro overtone layer ──────────────────────────────────────────────
    this.nitroOsc = this.context.createOscillator();
    this.nitroOsc.type = 'sawtooth';
    this.nitroOsc.frequency.value = 280;

    this.nitroOsc2 = this.context.createOscillator();
    this.nitroOsc2.type = 'triangle';
    this.nitroOsc2.frequency.value = 420;

    this.nitroGain = this.context.createGain();
    this.nitroGain.gain.value = 0.0001;

    const nitroFilter = this.context.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 350;
    nitroFilter.Q.value = 1.2;

    this.nitroOsc.connect(nitroFilter);
    this.nitroOsc2.connect(nitroFilter);
    nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.compressor);
    this.nitroOsc.start();
    this.nitroOsc2.start();

    // ─── Multi-cylinder engine oscillators ────────────────────────────────
    const layers = [
      { type: 'sawtooth', ratio: 1.0, gain: 0.40 },  // Fundamental
      { type: 'sawtooth', ratio: 1.5, gain: 0.25 },  // 5th harmonic growl
      { type: 'triangle', ratio: 0.5, gain: 0.35 },  // Sub-bass rumble
      { type: 'square',   ratio: 2.0, gain: 0.12 },  // Mechanical rattle
      { type: 'sine',     ratio: 4.0, gain: 0.05 },  // High metal whine
    ];

    layers.forEach(({ type, ratio, gain }) => {
      const osc = this.context.createOscillator();
      const layerGain = this.context.createGain();
      osc.type = type;
      osc.frequency.value = 30 * ratio;
      layerGain.gain.value = gain;
      osc.connect(layerGain);
      layerGain.connect(this.exhaustWaveshaper);
      osc.start();
      this.engineOscillators.push({ osc, ratio, layerGain, baseGain: gain });
    });

    if (this.bikeType) {
      this.setBikeType(this.bikeType);
    }

    this.started = true;
  }

  setBikeType(type) {
    this.bikeType = type || 'sports';
    if (!this.started || !this.engineOscillators.length) return;

    const now = this.context.currentTime;
    
    const profiles = {
      sports: [
        { type: 'sawtooth', ratio: 1.0, gain: 0.40 },
        { type: 'sawtooth', ratio: 1.5, gain: 0.25 },
        { type: 'triangle', ratio: 0.5, gain: 0.35 },
        { type: 'square',   ratio: 2.0, gain: 0.12 },
        { type: 'sine',     ratio: 4.0, gain: 0.05 },
      ],
      bullet: [
        { type: 'sawtooth', ratio: 1.0, gain: 0.55 },
        { type: 'sawtooth', ratio: 0.5, gain: 0.45 },
        { type: 'triangle', ratio: 0.25, gain: 0.60 },
        { type: 'square',   ratio: 1.0, gain: 0.35 },
        { type: 'sine',     ratio: 2.0, gain: 0.01 },
      ],
      modern: [
        { type: 'sine',     ratio: 1.0, gain: 0.30 },
        { type: 'triangle', ratio: 2.0, gain: 0.35 },
        { type: 'sine',     ratio: 0.5, gain: 0.20 },
        { type: 'sine',     ratio: 3.0, gain: 0.30 },
        { type: 'sine',     ratio: 6.0, gain: 0.18 },
      ],
      shadow: [
        { type: 'sawtooth', ratio: 1.0, gain: 0.55 },
        { type: 'square',   ratio: 1.5, gain: 0.40 },
        { type: 'sawtooth', ratio: 0.5, gain: 0.50 },
        { type: 'sawtooth', ratio: 2.0, gain: 0.25 },
        { type: 'triangle', ratio: 3.0, gain: 0.08 },
      ]
    };

    const p = profiles[this.bikeType] || profiles.sports;
    this.engineOscillators.forEach((layer, i) => {
      if (p[i]) {
        layer.osc.type = p[i].type;
        layer.ratio = p[i].ratio;
        layer.baseGain = p[i].gain;
        layer.layerGain.gain.setTargetAtTime(p[i].gain, now, 0.05);
      }
    });

    if (this.exhaustWaveshaper) {
      let distAmount = 44;
      if (this.bikeType === 'bullet') distAmount = 25;
      if (this.bikeType === 'modern') distAmount = 5;
      if (this.bikeType === 'shadow') distAmount = 85;
      this.exhaustWaveshaper.curve = this.makeDistortionCurve(distAmount);
    }
  }

  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  update(speed, throttle, boosting, paused) {
    if (!this.context || !this.started) return;
    const now = this.context.currentTime;

    const topSpeed = 300;
    const normalizedSpeed = Math.min(1, speed / topSpeed);

    // ─── 5-gear simulation ─────────────────────────────────────────────────
    const numGears = 5;
    const gearSpan = 1 / numGears;
    const currentGear = speed < 5 ? 0 : Math.min(numGears, Math.floor(normalizedSpeed / gearSpan) + 1);
    const gearProgress = (normalizedSpeed % gearSpan) / gearSpan;
    const rpm = 0.2 + gearProgress * 0.62 + throttle * 0.2 + (boosting ? 0.15 : 0);

    // Gear shift sound trigger
    if (currentGear !== this._lastGear && currentGear > 0 && !paused) {
      this._gearShift(currentGear);
    }
    this._lastGear = currentGear;

    // Backfire on throttle lift-off at high speed
    if (this._lastSpeed > 160 && speed < this._lastSpeed - 8 && !boosting && !paused) {
      this._backfireTimer -= 1;
      if (this._backfireTimer <= 0) {
        this.backfire();
        this._backfireTimer = 6 + Math.floor(Math.random() * 8);
      }
    }
    this._lastSpeed = speed;

    let baseFrequency = 28 + rpm * 115;
    if (this.bikeType === 'bullet') {
      baseFrequency = 15 + rpm * 60;
    } else if (this.bikeType === 'modern') {
      baseFrequency = 52 + rpm * 240;
    } else if (this.bikeType === 'shadow') {
      baseFrequency = 20 + rpm * 82;
    }

    // Engine oscillators
    this.engineOscillators.forEach(({ osc, ratio, layerGain, baseGain }) => {
      osc.frequency.setTargetAtTime(baseFrequency * ratio, now, 0.04);
      if (osc.type === 'sawtooth') {
        layerGain.gain.setTargetAtTime(baseGain * (1 + throttle * 0.55), now, 0.05);
      }
    });

    // Exhaust filter
    const filterFreq = 250 + rpm * 1700 + throttle * 420;
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);

    // Intake noise
    const noiseFreq = 200 + normalizedSpeed * 850 + throttle * 320;
    this.noiseFilter.frequency.setTargetAtTime(noiseFreq, now, 0.04);
    this.noiseGain.gain.setTargetAtTime(0.002 + throttle * 0.016 + normalizedSpeed * 0.012, now, 0.06);

    // Wind rush — scales strongly with speed
    const windFreq = 400 + normalizedSpeed * 2800;
    this.windFilter.frequency.setTargetAtTime(windFreq, now, 0.08);
    this.windGain.gain.setTargetAtTime(normalizedSpeed * normalizedSpeed * 0.07 + throttle * 0.01, now, 0.1);

    // Nitro overtone layer
    const nitroTarget = boosting ? 0.055 : 0.0001;
    this.nitroOsc.frequency.setTargetAtTime(260 + rpm * 180, now, 0.06);
    this.nitroOsc2.frequency.setTargetAtTime(410 + rpm * 220, now, 0.06);
    this.nitroGain.gain.setTargetAtTime(nitroTarget, now, 0.08);

    // Master engine volume
    const isQuiet = paused || this.muted;
    const targetGain = isQuiet ? 0.0001 : 0.08 + throttle * 0.072 + rpm * 0.052;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.05);
  }

  // ─── Gear shift pop ──────────────────────────────────────────────────────
  _gearShift(gear) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    // Brief pitch dip then snap up — classic sequential gearbox feel
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 140 + gear * 22;
    filter.Q.value = 2.5;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95 + gear * 12, now);
    osc.frequency.exponentialRampToValueAtTime(55 + gear * 8, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(110 + gear * 14, now + 0.1);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.13, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // ─── Exhaust backfire ────────────────────────────────────────────────────
  backfire() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    // Filtered noise pop burst
    const len = Math.floor(this.context.sampleRate * 0.06);
    const buf = this.context.createBuffer(1, len, this.context.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    }
    const src = this.context.createBufferSource();
    const filt = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filt.type = 'bandpass';
    filt.frequency.value = 260 + Math.random() * 160;
    filt.Q.value = 3;
    gain.gain.value = 0.28 + Math.random() * 0.14;
    src.buffer = buf;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.compressor);
    src.start(now);
    // Second crackle
    if (Math.random() > 0.45) {
      setTimeout(() => {
        if (!this.context) return;
        const now2 = this.context.currentTime;
        const src2 = this.context.createBufferSource();
        const buf2 = this.context.createBuffer(1, Math.floor(this.context.sampleRate * 0.04), this.context.sampleRate);
        const d2 = buf2.getChannelData(0);
        for (let i = 0; i < buf2.length; i++) d2[i] = (Math.random() * 2 - 1) * (1 - i / buf2.length);
        const g2 = this.context.createGain();
        g2.gain.value = 0.15;
        src2.buffer = buf2;
        src2.connect(g2);
        g2.connect(this.compressor);
        src2.start(now2);
      }, 50 + Math.random() * 60);
    }
  }

  // ─── Tire screech ────────────────────────────────────────────────────────
  tireScreech(intensity = 0.5) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const dur = 0.15 + intensity * 0.2;
    const len = Math.floor(this.context.sampleRate * dur);
    const buf = this.context.createBuffer(1, len, this.context.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.9;
    }
    const src = this.context.createBufferSource();
    const filt = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filt.type = 'highpass';
    filt.frequency.value = 2200;
    filt.Q.value = 0.6;
    gain.gain.value = Math.min(0.22, 0.08 * intensity);
    src.buffer = buf;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.compressor);
    src.start(now);
  }

  // ─── Near-miss whoosh ────────────────────────────────────────────────────
  nearMissWhoosh() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    // Doppler-style pitch sweep
    const osc = this.context.createOscillator();
    const osc2 = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.28);
    osc2.frequency.setValueAtTime(1800, now);
    osc2.frequency.exponentialRampToValueAtTime(280, now + 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    const filt = this.context.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 900;
    filt.Q.value = 1.4;
    osc.connect(filt);
    osc2.connect(filt);
    filt.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.31);
    osc2.stop(now + 0.31);
  }

  countdown(tone = 0) {
    this.beep(tone === 3 ? 640 : 400, tone === 3 ? 0.26 : 0.15, tone === 3 ? 0.24 : 0.14);
  }

  impact(strength = 1) {
    if (!this.context || !this.master) return;
    const duration = 0.32;
    const length = Math.floor(this.context.sampleRate * duration);
    const buf = this.context.createBuffer(1, length, this.context.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const decay = 1 - i / length;
      d[i] = (Math.random() * 2 - 1) * decay * decay * decay;
    }

    const src = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 200 + strength * 280;
    filter.Q.value = 1.4;
    gain.gain.value = Math.min(0.55, 0.25 * strength);
    src.buffer = buf;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    src.start();

    // Metallic ring overtone
    const ring = this.context.createOscillator();
    const ringGain = this.context.createGain();
    ring.type = 'sine';
    ring.frequency.value = 380 + strength * 120;
    const now = this.context.currentTime;
    ringGain.gain.setValueAtTime(0.07 * strength, now);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    ring.connect(ringGain);
    ringGain.connect(this.compressor);
    ring.start(now);
    ring.stop(now + 0.24);
  }

  strike() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  boost() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const osc2 = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(82, now);
    osc.frequency.exponentialRampToValueAtTime(390, now + 0.42);
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(85, now);
    osc2.frequency.exponentialRampToValueAtTime(395, now + 0.42);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.5);
    osc2.stop(now + 0.5);
  }

  beep(frequency, duration, volume) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + duration);
  }

  // ─── Takedown cheer ──────────────────────────────────────────────────────
  takedownSound() {
    if (!this.context) return;
    const now = this.context.currentTime;
    [0, 0.06, 0.14].forEach((t, i) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 220 + i * 110;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.linearRampToValueAtTime(0.12 - i * 0.02, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.14);
      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(now + t);
      osc.stop(now + t + 0.16);
    });
  }

  // ─── Checkpoint chime ────────────────────────────────────────────────────
  checkpointChime() {
    if (!this.context) return;
    const notes = [523, 659, 784];
    notes.forEach((freq, i) => {
      this.beep(freq, 0.18, 0.12 - i * 0.02);
      setTimeout(() => {}, i * 90);
    });
    // Stagger properly
    const now = this.context.currentTime;
    notes.forEach((freq, i) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.11, now + i * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.22);
      osc.connect(gain);
      gain.connect(this.compressor);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.25);
    });
  }
}