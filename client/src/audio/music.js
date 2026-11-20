/**
 * Nhạc nền cướp biển — tự soạn, tổng hợp hoàn toàn bằng Web Audio (không cần file mp3).
 * Phong cách hò biển nhịp 6/8, giọng Rê thứ: bass "bùm", hợp âm kiểu accordion,
 * giai điệu sáo/kèn và trống. Hai mức: 'calm' (menu, nhẹ) và 'battle' (trong trận, nhanh hơn, có trống).
 *
 * Bộ lập lịch "nhìn trước" (lookahead): mỗi 25ms lên lịch các nốt trong 120ms tới
 * bằng đồng hồ của AudioContext nên nhịp đều, không bị giật khi game nặng.
 */
const STORAGE_KEY = 'pirate-battle:music';
const VOLUME = 0.32;
const LOOKAHEAD = 0.12;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Hợp âm mỗi ô nhịp: [bass gốc, bass quãng 5, các nốt hợp âm]
const CH = {
  Dm: [38, 45, [62, 65, 69]],
  C: [36, 43, [60, 64, 67]],
  Bb: [34, 41, [58, 62, 65]],
  A: [33, 40, [57, 61, 64]],
  Gm: [31, 38, [55, 58, 62]],
};
const PROGRESSION = ['Dm', 'Dm', 'C', 'C', 'Bb', 'Bb', 'A', 'A', 'Dm', 'Dm', 'Gm', 'Gm', 'Bb', 'C', 'A', 'Dm'];

// Giai điệu: mỗi ô nhịp 6 móc đơn, [nốt MIDI, độ dài tính bằng móc đơn]; null = nghỉ
const MELODY = [
  [[69, 2], [74, 1], [74, 2], [76, 1]],
  [[77, 2], [76, 1], [74, 2], [69, 1]],
  [[67, 2], [72, 1], [72, 2], [74, 1]],
  [[76, 3], [72, 3]],
  [[74, 2], [70, 1], [77, 2], [74, 1]],
  [[70, 2], [72, 1], [74, 3]],
  [[76, 2], [73, 1], [69, 2], [73, 1]],
  [[76, 3], [69, 3]],
  [[74, 1], [77, 1], [81, 1], [81, 2], [79, 1]],
  [[77, 2], [76, 1], [74, 3]],
  [[70, 1], [74, 1], [79, 1], [79, 2], [77, 1]],
  [[76, 2], [74, 1], [70, 3]],
  [[77, 2], [74, 1], [70, 2], [74, 1]],
  [[76, 2], [79, 1], [72, 3]],
  [[73, 2], [76, 1], [81, 2], [79, 1]],
  [[77, 2], [76, 1], [74, 3]],
];

// Đổi giai điệu thành bảng theo từng móc đơn: step -> [nốt, độ dài]
const MELODY_STEPS = (() => {
  const steps = [];
  MELODY.forEach((bar, b) => {
    let pos = 0;
    for (const [note, len] of bar) {
      steps[b * 6 + pos] = note === null ? null : [note, len];
      pos += len;
    }
  });
  return steps;
})();
const LOOP_STEPS = PROGRESSION.length * 6;

const MOODS = {
  calm: { bpm: 72, drums: false, melodyGain: 0.55, padGain: 0.5 },
  battle: { bpm: 84, drums: true, melodyGain: 0.75, padGain: 0.6 },
};

export class Music {
  constructor(sound) {
    this.sound = sound;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      /* dùng mặc định */
    }
    this.mood = 'calm';
    this.nextMood = 'calm';
    this.playing = false;
    this.step = 0;
    this.timer = null;
  }

  get ctx() {
    return this.sound.ctx;
  }

  /** Gọi sau khi âm thanh được mở khoá (có thao tác người dùng). */
  start() {
    if (!this.ctx || this.playing || !this.enabled) return;
    if (!this.out) {
      this.out = this.ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(this.sound.out);
    }
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.out.gain.setTargetAtTime(VOLUME, this.ctx.currentTime, 0.8); // vào nhạc nhẹ nhàng
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* bỏ qua */
    }
    if (on) this.start();
    else this.stop();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** 'calm' (menu) | 'battle' (trong trận). Đổi ở đầu ô nhịp kế tiếp cho mượt. */
  setMood(mood) {
    if (MOODS[mood]) this.nextMood = mood;
  }

  // ------------------------------------------------------------ lập lịch
  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // Tab bị ẩn lâu -> nhảy tới hiện tại thay vì phát dồn
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    // Tab bị ẩn: trình duyệt chỉ chạy hẹn giờ ~1 lần/giây -> lên lịch trước xa hơn để nhạc không hụt
    const ahead = document.hidden ? 1.6 : LOOKAHEAD;
    while (this.nextTime < ctx.currentTime + ahead) {
      if (this.step % 6 === 0) this.mood = this.nextMood;
      const m = MOODS[this.mood];
      const eighth = 60 / m.bpm / 3; // nhịp 6/8: một phách = móc đơn chấm, 3 móc đơn
      this.playStep(this.step % LOOP_STEPS, this.nextTime, eighth, m);
      this.nextTime += eighth;
      this.step++;
    }
  }

  playStep(step, t, eighth, m) {
    const bar = Math.floor(step / 6);
    const beat = step % 6;
    const [root, fifth, chord] = CH[PROGRESSION[bar]];

    // Bass "bùm" ở phách 1 và 2 (móc đơn 0 và 3)
    if (beat === 0) this.bass(midi(root), t, eighth * 2.6);
    if (beat === 3) this.bass(midi(fifth), t, eighth * 2.6);

    // Hợp âm accordion "chát" ở các móc đơn còn lại (kiểu bùm-chát-chát)
    if (beat === 1 || beat === 2 || beat === 4 || beat === 5) {
      for (const n of chord) this.pad(midi(n), t, eighth * 0.8, m.padGain * (beat === 1 || beat === 4 ? 1 : 0.7));
    }

    // Giai điệu
    const mel = MELODY_STEPS[step];
    if (mel) this.lead(midi(mel[0]), t, eighth * mel[1] * 0.92, m.melodyGain);

    // Trống (chỉ trong trận)
    if (m.drums) {
      if (beat === 0) this.kick(t);
      if (beat === 3) this.snare(t, 0.5);
      if (bar % 4 === 3 && beat === 5) this.snare(t, 0.35); // dồn trống cuối câu
      this.shaker(t, beat % 3 === 0 ? 0.12 : 0.07);
    }
  }

  // ------------------------------------------------------------ nhạc cụ
  env(t, peak, attack, hold, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.out);
    return g;
  }

  bass(freq, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.connect(this.env(t, 0.55, 0.01, dur * 0.3, dur * 0.7));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Accordion: hai sóng răng cưa lệch nhẹ qua bộ lọc thấp. */
  pad(freq, t, dur, gain) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.Q.value = 0.7;
    lp.connect(this.env(t, 0.06 * gain, 0.015, dur * 0.5, dur * 0.5));
    for (const detune of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Giai điệu kiểu kèn/sáo: sóng vuông mềm + rung nhẹ. */
  lead(freq, t, dur, gain) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = this.ctx.createGain();
    vibGain.gain.value = freq * 0.006;
    vib.connect(vibGain).connect(o.frequency);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    o.connect(lp).connect(this.env(t, 0.11 * gain, 0.02, dur * 0.6, dur * 0.4));
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    o.connect(this.env(t, 0.7, 0.003, 0.02, 0.22));
    o.start(t);
    o.stop(t + 0.3);
  }

  noise(t, dur, freq, q, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sound.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    src.connect(bp).connect(this.env(t, gain, 0.002, 0.01, dur));
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.05);
  }

  snare(t, gain) {
    this.noise(t, 0.16, 1800, 0.8, 0.35 * gain);
  }

  shaker(t, gain) {
    this.noise(t, 0.05, 7000, 1.2, gain * 0.5);
  }
}
