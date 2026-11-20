import * as THREE from 'three';
import { TEAMS, PLAYER_TEAM, AMMO } from '../config/game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  sound: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
  music: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Giao diện trong trận: thông số tàu (trái trên), tỉ số đội + nút (phải trên), thông báo,
 * bảng hạ gục, nhắc nạp đạn, đếm ngược hồi sinh, nhãn trên đầu tàu, số bay, tạm dừng, tổng kết.
 */
export class Hud {
  constructor({ camera, onPause, onResume, onToggleSound, onToggleMusic, audioState, onRestart, onMenu, muted }) {
    this.camera = camera;
    this.audioState = audioState;
    this.callbacks = { onPause, onResume, onToggleSound, onToggleMusic, onRestart, onMenu };

    this.left = document.getElementById('hud');
    this.right = document.getElementById('hud-right');
    this.labelsLayer = document.getElementById('labels');
    this.pauseEl = document.getElementById('pause');
    this.summaryEl = document.getElementById('summary');
    this.hitOverlay = document.getElementById('hit-overlay');
    this.toastsEl = document.getElementById('toasts');
    this.feedEl = document.getElementById('killfeed');
    this.promptEl = document.getElementById('prompt');
    this.respawnEl = document.getElementById('respawn');

    this.left.innerHTML = `
      <div class="hud-row hud-hp">
        <span class="label">Thân tàu</span>
        <div class="hp-bar"><div id="hp-fill"></div></div>
        <span class="num" id="hp-text">100</span>
      </div>
      <div class="hud-row">
        <span class="label">Đạn</span>
        <div class="ammo-pips" id="ammo-pips">${'<i></i>'.repeat(AMMO.max)}</div>
        <span class="num" id="ammo-text">10/10</span>
      </div>
      <div class="hud-row"><span class="label">Tốc độ</span><span class="num" id="speed">0.0</span><span class="unit">kn</span></div>
      <div class="hud-row"><span class="label">Mạn trái</span><span class="num" id="reload-left">SẴN SÀNG</span></div>
      <div class="hud-row"><span class="label">Mạn phải</span><span class="num" id="reload-right">SẴN SÀNG</span></div>`;

    this.right.innerHTML = `
      <div class="scoreboard">
        <div class="sb-mode label" id="sb-mode"></div>
        <div class="sb-scores">
          <span class="sb-team blue"><span class="sb-name">Xanh</span><span class="num sb-val" id="score-blue">0</span></span>
          <span class="sb-target num" id="sb-target">/ 30</span>
          <span class="sb-team red"><span class="num sb-val" id="score-red">0</span><span class="sb-name">Đỏ</span></span>
        </div>
        <div class="sb-status" id="sb-status"></div>
      </div>
      <div class="score">
        <div class="score-cell"><span class="label">Hạ / Chìm</span><span class="num score-val" id="kd">0 / 0</span></div>
        <div class="score-cell"><span class="label">Vàng</span><span class="num score-val gold" id="gold">0</span></div>
      </div>
      <div class="hud-buttons">
        <button type="button" class="icon-btn" id="pause-btn" title="Menu / Tạm dừng (ESC)">${ICON.pause}<span class="kbd">ESC</span></button>
        <button type="button" class="icon-btn" id="music-btn" title="Bật/tắt nhạc nền (N)">${ICON.music}</button>
        <button type="button" class="icon-btn" id="sound-btn" title="Bật/tắt âm thanh"></button>
      </div>`;

    const q = (root, sel) => root.querySelector(sel);
    this.el = {
      hpFill: q(this.left, '#hp-fill'),
      hpText: q(this.left, '#hp-text'),
      ammoPips: [...q(this.left, '#ammo-pips').children],
      ammoText: q(this.left, '#ammo-text'),
      speed: q(this.left, '#speed'),
      reloadL: q(this.left, '#reload-left'),
      reloadR: q(this.left, '#reload-right'),
      sbMode: q(this.right, '#sb-mode'),
      scoreBlue: q(this.right, '#score-blue'),
      scoreRed: q(this.right, '#score-red'),
      sbTarget: q(this.right, '#sb-target'),
      sbStatus: q(this.right, '#sb-status'),
      kd: q(this.right, '#kd'),
      gold: q(this.right, '#gold'),
      soundBtn: q(this.right, '#sound-btn'),
      musicBtn: q(this.right, '#music-btn'),
    };
    this.el.musicBtn.addEventListener('click', () => this.callbacks.onToggleMusic?.());
    q(this.right, '#pause-btn').addEventListener('click', () => this.callbacks.onPause?.());
    this.el.soundBtn.addEventListener('click', () => this.callbacks.onToggleSound?.());
    this.setMuted(muted);

    this.pauseEl.innerHTML = `
      <div class="modal">
        <div class="label">Tạm dừng</div>
        <h2>Neo tàu nghỉ ngơi</h2>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-act="resume">Tiếp tục</button>
          <button type="button" class="btn" data-act="menu">Về Menu đổi tàu</button>
        </div>
        <div class="audio-row">
          <button type="button" class="toggle" data-act="music"></button>
          <button type="button" class="toggle" data-act="sfx"></button>
        </div>
        <div class="label muted">ESC để tiếp tục · N bật/tắt nhạc</div>
      </div>`;
    this.pauseEl.querySelector('[data-act=resume]').addEventListener('click', () => this.callbacks.onResume?.());
    this.pauseEl.querySelector('[data-act=menu]').addEventListener('click', () => this.callbacks.onMenu?.());
    this.pauseEl.querySelector('[data-act=music]').addEventListener('click', () => this.callbacks.onToggleMusic?.());
    this.pauseEl.querySelector('[data-act=sfx]').addEventListener('click', () => this.callbacks.onToggleSound?.());

    this.labels = new Map();
    this.floaters = [];
    this.tmp = new THREE.Vector3();
    this.hitFlash = 0;
    this.lastStatus = '';
  }

  setMuted(m) {
    this.el.soundBtn.innerHTML = m ? ICON.mute : ICON.sound;
    this.el.soundBtn.classList.toggle('off', !!m);
    const b = this.pauseEl.querySelector('[data-act=sfx]');
    if (b) {
      b.textContent = `Âm thanh: ${m ? 'Tắt' : 'Bật'}`;
      b.classList.toggle('on', !m);
    }
  }

  setMusic(on) {
    this.el.musicBtn.classList.toggle('off', !on);
    const b = this.pauseEl.querySelector('[data-act=music]');
    if (b) {
      b.textContent = `Nhạc nền: ${on ? 'Bật' : 'Tắt'}`;
      b.classList.toggle('on', on);
    }
  }

  setVisible(v) {
    for (const el of [this.left, this.right, this.labelsLayer, this.toastsEl, this.feedEl]) el.hidden = !v;
    if (!v) {
      this.promptEl.hidden = true;
      this.respawnEl.hidden = true;
    }
  }

  setMode(mode, settings) {
    this.el.sbMode.textContent = `${mode.def.name} · ${settings.target} ${mode.hudInfo().unit}`;
    this.el.sbTarget.textContent = `/ ${settings.target}`;
    this.toastsEl.innerHTML = '';
    this.feedEl.innerHTML = '';
  }

  /** online = true: trận vẫn chạy, chỉ mở menu (không thật sự tạm dừng). */
  showPause(v, online = false) {
    this.pauseEl.hidden = !v;
    if (!v) return;
    const a = this.audioState?.();
    if (a) {
      this.setMusic(a.music);
      this.setMuted(!a.sound);
    }
    this.pauseEl.querySelector('.label').textContent = online ? 'Menu' : 'Tạm dừng';
    this.pauseEl.querySelector('h2').textContent = online ? 'Trận online vẫn đang diễn ra' : 'Neo tàu nghỉ ngơi';
    this.pauseEl.querySelector('[data-act=menu]').textContent = online ? 'Rời phòng' : 'Về Menu đổi tàu';
  }

  flashHit() {
    this.hitFlash = 0.35;
  }

  /** Thông báo ngắn giữa trên màn hình. tone: 'blue' | 'red' | 'warn' | null */
  toast(text, tone = null) {
    const el = document.createElement('div');
    el.className = `toast ${tone || ''}`;
    el.textContent = text;
    this.toastsEl.prepend(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3600);
  }

  killFeed(byName, byTeam, victimName, victimTeam) {
    const el = document.createElement('div');
    el.className = 'feed-row';
    const name = (n, t) => `<span class="feed-name ${t || ''}">${esc(n)}</span>`;
    el.innerHTML = `${name(byName, byTeam)}<span class="feed-verb">đã đánh chìm</span>${name(victimName, victimTeam)}`;
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  showSummary(s) {
    const row = (k, v, cls = '') => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;
    this.summaryEl.innerHTML = `
      <div class="modal">
        <div class="label">${esc(s.mode)} · ${s.victory ? 'Chiến thắng' : 'Thất bại'}</div>
        <h2>${s.victory ? 'Đội Xanh thắng trận!' : 'Đội Đỏ đã thắng…'}</h2>
        <div class="final-score">
          <span class="blue"><span class="num">${s.scores.blue}</span> Xanh</span>
          <span class="muted num">/ ${s.target} ${esc(s.unit)}</span>
          <span class="red">Đỏ <span class="num">${s.scores.red}</span></span>
        </div>
        <dl class="summary-table">
          ${row('Thuyền trưởng', esc(s.captain))}
          ${row('Tàu', esc(s.shipName))}
          ${row('Hạ gục / Bị chìm', `${s.kills} / ${s.deaths}`, 'num')}
          ${s.showFlags ? row('Cờ cướp được', s.flags, 'num') : ''}
          ${row('Sát thương gây ra', Math.round(s.damage), 'num')}
          ${row('Vàng', s.gold, 'num gold')}
          ${row('Thời gian trận', formatTime(s.time), 'num')}
        </dl>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-act="restart">Chơi lại ngay</button>
          <button type="button" class="btn" data-act="menu">Về Menu đổi tàu</button>
        </div>
      </div>`;
    this.summaryEl.querySelector('[data-act=restart]').addEventListener('click', () => this.callbacks.onRestart?.());
    this.summaryEl.querySelector('[data-act=menu]').addEventListener('click', () => this.callbacks.onMenu?.());
    this.summaryEl.hidden = false;
    this.promptEl.hidden = true;
    this.respawnEl.hidden = true;
  }

  hideSummary() {
    this.summaryEl.hidden = true;
  }

  update(dt, { player, stats, info, depot, respawnIn }) {
    const hpPct = (player.hp / player.maxHp) * 100;
    this.el.hpFill.style.width = hpPct + '%';
    this.el.hpFill.dataset.level = hpPct > 50 ? 'ok' : hpPct > 25 ? 'warn' : 'low';
    this.el.hpText.textContent = `${Math.ceil(player.hp)}/${player.maxHp}`;
    this.el.ammoPips.forEach((pip, i) => pip.classList.toggle('on', i < player.ammo));
    this.el.ammoText.textContent = `${player.ammo}/${player.maxAmmo}`;
    this.el.ammoText.classList.toggle('empty', player.ammo === 0);
    this.el.speed.textContent = (Math.abs(player.speed) * 0.8).toFixed(1);
    this.setReload(this.el.reloadL, player.reload.left, player.ammo);
    this.setReload(this.el.reloadR, player.reload.right, player.ammo);

    this.el.scoreBlue.textContent = info.scores.blue;
    this.el.scoreRed.textContent = info.scores.red;
    const statusKey = info.status.map((s) => s.text).join('|');
    if (statusKey !== this.lastStatus) {
      this.lastStatus = statusKey;
      this.el.sbStatus.innerHTML = info.status
        .map((s) => `<span class="sb-flag ${s.team} ${s.alert ? 'alert' : ''}">${TEAMS[s.team].name}: ${esc(s.text)}</span>`)
        .join('');
    }
    this.el.kd.textContent = `${stats.kills} / ${stats.deaths}`;
    this.el.gold.textContent = stats.gold;

    // Nhắc nạp đạn / giữ cờ
    let prompt = '';
    if (!player.sunk) {
      if (player.resupply > 0) {
        const pct = Math.min(100, (player.resupply / AMMO.resupplyTime) * 100);
        prompt = `<span>Đang nạp đạn…</span><span class="prompt-bar"><i style="width:${pct}%"></i></span>`;
      } else if (depot && player.ammo < player.maxAmmo) {
        prompt = `<kbd>R</kbd><span>Nạp đạn tại tháp</span>`;
      } else if (player.ammo === 0) {
        prompt = `<span class="warn-text">Hết đạn</span><span>· tới tháp tiếp đạn (biểu tượng trắng trên bản đồ)</span>`;
      } else if (player.carryingFlag) {
        prompt = `<span class="warn-text">Đang giữ cờ ${TEAMS[player.carryingFlag.team].name}</span><span>· mang về cứ điểm ${TEAMS[player.team]?.name ?? ''}</span>`;
      }
    }
    this.promptEl.hidden = !prompt;
    if (prompt && this.promptEl.innerHTML !== prompt) this.promptEl.innerHTML = prompt;

    this.respawnEl.hidden = !(respawnIn > 0);
    if (respawnIn > 0) {
      this.respawnEl.innerHTML = `<div class="label">Tàu đã chìm</div><div class="respawn-count num">${Math.ceil(respawnIn)}</div><div class="muted">Hồi sinh tại cứ điểm…</div>`;
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.hitOverlay.style.opacity = (this.hitFlash / 0.35) * 0.5;
  }

  setReload(el, t, ammo) {
    if (ammo <= 0) {
      el.textContent = 'HẾT ĐẠN';
      el.className = 'num empty';
    } else if (t > 0) {
      el.textContent = `${t.toFixed(1)}s`;
      el.className = 'num reloading';
    } else {
      el.textContent = 'SẴN SÀNG';
      el.className = 'num ready';
    }
  }

  project(pos, out = this.tmp) {
    out.copy(pos).project(this.camera);
    if (out.z > 1) return null;
    return { x: (out.x * 0.5 + 0.5) * window.innerWidth, y: (-out.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Nhãn tên + thanh máu lơ lửng trên đầu các tàu (màu theo đội). */
  syncLabels(ships) {
    const alive = new Set();
    for (const s of ships) {
      if (s.isPlayer) continue;
      alive.add(s);
      let el = this.labels.get(s);
      if (!el) {
        el = document.createElement('div');
        el.className = `ship-label ${s.team === 'blue' ? 'ally' : 'enemy'}`;
        el.innerHTML = `<span class="ship-label-name">${esc(s.name)}</span><span class="ship-label-hp"><i></i></span>`;
        this.labelsLayer.appendChild(el);
        this.labels.set(s, el);
      }
      const anchor = this.tmp.copy(s.position);
      anchor.y += s.height * 0.95 + 1;
      const sp = this.project(anchor);
      if (!sp || s.sunk) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.classList.toggle('carrier', !!s.carryingFlag);
      el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -100%)`;
      el.lastChild.firstChild.style.width = (s.hp / s.maxHp) * 100 + '%';
    }
    for (const [s, el] of this.labels) {
      if (!alive.has(s)) {
        el.remove();
        this.labels.delete(s);
      }
    }
  }

  floatText(pos, text, kind = 'dmg') {
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = text;
    this.labelsLayer.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), age: 0, life: 1.2, dx: (Math.random() - 0.5) * 30 });
  }

  updateFloaters(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const t = f.age / f.life;
      const sp = this.project(this.tmp.copy(f.pos).add(new THREE.Vector3(0, 2 + t * 5, 0)));
      if (!sp) {
        f.el.style.display = 'none';
        continue;
      }
      f.el.style.display = '';
      f.el.style.opacity = String(1 - t * t);
      f.el.style.transform = `translate(${sp.x + f.dx * t}px, ${sp.y}px) translate(-50%, -50%) scale(${1 + (1 - t) * 0.25})`;
    }
  }

  clearWorldUi() {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
    this.toastsEl.innerHTML = '';
    this.feedEl.innerHTML = '';
    this.promptEl.hidden = true;
    this.respawnEl.hidden = true;
  }
}
