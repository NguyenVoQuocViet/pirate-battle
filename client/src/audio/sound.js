/**
 * Âm thanh tổng hợp hoàn toàn bằng Web Audio API (không cần file ngoài).
 * - cannon: tiếng đại bác nổ trầm
 * - splash: đạn rơi tùm xuống nước
 * - hit: gỗ vỡ khi trúng tàu
 * - thud: đạn cắm vào đất/đá
 * - explode: tàu phát nổ khi chìm
 * - coin: leng keng khi nhặt kho báu
 * Âm lượng giảm dần theo khoảng cách tới người nghe (tàu người chơi).
 */
const STORAGE_KEY = 'pirate-battle:muted';
const HEAR_RANGE = 260;

export class Sound {
  constructor() {
    this.ctx = null;
    this.listener = { x: 0, z: 0 };
    this.muted = false;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* bộ nhớ trình duyệt bị chặn: dùng mặc định */
    }
    this.lastPlay = {}; // chống dồn quá nhiều âm giống nhau cùng lúc
  }

  /** Gọi trong một thao tác người dùng (click/phím) để trình duyệt cho phép phát âm thanh. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(this.ctx.destination);
      this.out = comp; // lối ra chung: nhạc nền nối vào đây, không qua nút tắt âm thanh hiệu ứng
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(comp);
      // Bộ đệm nhiễu trắng dùng chung
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.onUnlock?.();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
    } catch {
      /* bỏ qua */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setListener(x, z) {
    this.listener.x = x;
    this.listener.z = z;
  }

  // ---------- tiện ích ----------
  volumeAt(pos) {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z);
    return Math.max(0, 1 - d / HEAR_RANGE) ** 1.5;
  }

  ready(name, minGap) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (this.lastPlay[name] && now - this.lastPlay[name] < minGap) return false;
    this.lastPlay[name] = now;
    return true;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  envGain(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** Tiếng "bùm" trầm: nhiễu lọc thấp + sóng sin trượt tần số xuống. */
  boom(pos, { gain = 1, decay = 0.7, cutoff = 900, pitch = 110 } = {}) {
    const v = this.volumeAt(pos) * gain;
    if (v < 0.02) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + decay);
    const ng = this.envGain(t, 0.9 * v, 0.005, decay);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + decay + 0.1);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pitch * (0.9 + Math.random() * 0.2), t);
    o.frequency.exponentialRampToValueAtTime(35, t + decay * 0.5);
    const og = this.envGain(t, 0.8 * v, 0.004, decay * 0.55);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + decay);
  }

  // ---------- âm thanh trò chơi ----------
  cannon(pos) {
    if (!this.ready('cannon', 0.03)) return;
    this.boom(pos, { gain: 0.8, decay: 0.6 });
  }

  explode(pos) {
    if (!this.ready('explode', 0.1)) return;
    this.boom(pos, { gain: 1.3, decay: 1.6, cutoff: 600, pitch: 70 });
    // tiếng lách tách của gỗ cháy
    setTimeout(() => this.hit(pos, 0.6), 120);
    setTimeout(() => this.hit(pos, 0.4), 320);
  }

  splash(pos) {
    if (!this.ready('splash', 0.04)) return;
    const v = this.volumeAt(pos);
    if (v < 0.02) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const g = this.envGain(t, 0.6 * v, 0.01, 0.55);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.7);
    // tiếng "tùm"
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.14);
    const og = this.envGain(t, 0.35 * v, 0.003, 0.15);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  hit(pos, gain = 1) {
    if (!this.ready('hit' + gain, 0.03)) return;
    const v = this.volumeAt(pos) * gain;
    if (v < 0.02) return;
    const t = this.ctx.currentTime;
    // tiếng gỗ "cốp" + vỡ vụn
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    const og = this.envGain(t, 0.7 * v, 0.002, 0.16);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);

    const n = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.6;
    const g = this.envGain(t, 0.55 * v, 0.002, 0.22);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.3);
    this.boom(pos, { gain: 0.5 * gain, decay: 0.4, cutoff: 700 });
  }

  thud(pos) {
    if (!this.ready('thud', 0.05)) return;
    this.boom(pos, { gain: 0.45, decay: 0.35, cutoff: 500, pitch: 90 });
  }

  /** Nâng cấp thành công: hợp âm đi lên sáng rõ. */
  upgrade() {
    if (!this.ready('upgrade', 0.1)) return;
    const t0 = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * 0.06;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.envGain(t, 0.22, 0.01, 0.45);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  /** Nhặt thùng buff: âm "vút" lên. */
  powerup() {
    if (!this.ready('powerup', 0.1)) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = this.envGain(t, 0.2, 0.02, 0.4);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  /** Kích hoạt lướt sóng: tiếng gió + sóng ào. */
  whoosh() {
    if (!this.ready('whoosh', 0.2)) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
    const g = this.envGain(t, 0.5, 0.08, 0.9);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 1.1);
  }

  /** Không đủ vàng / không dùng được. */
  deny() {
    if (!this.ready('deny', 0.15)) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(180, t);
    const g = this.envGain(t, 0.12, 0.005, 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  coin() {
    if (!this.ready('coin', 0.05)) return;
    const t0 = this.ctx.currentTime;
    [1318.5, 1760, 2637].forEach((f, i) => {
      const t = t0 + i * 0.07;
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5000;
      const g = this.envGain(t, 0.18, 0.004, 0.25);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.3);
    });
  }
}
