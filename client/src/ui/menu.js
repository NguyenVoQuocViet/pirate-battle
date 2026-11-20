import { SHIP_TYPES, DEFAULT_SHIP_ID, DISPLAY_STATS, statRatio, getShipType } from '../config/ships.js';
import { TEAM_SIZE_OPTIONS, DEFAULT_TEAM_SIZE, MODES, DEFAULT_MODE, NET } from '../config/game.js';
import { SERVER_URL } from '../net/network.js';
import { guideHtml, bindGuide } from './guide.js';

const PLAY_TYPES = [
  { id: 'offline', name: 'Chơi đơn', hint: 'Offline' },
  { id: 'public', name: 'Online', hint: 'Phòng chung' },
  { id: 'private', name: 'Phòng riêng', hint: 'Mã mời bạn bè' },
];
const CODE_RE = /^[A-Z0-9]{4,6}$/;
const ONLINE_MODES = [
  { id: 'ffa', name: 'Tự do', desc: 'Ai cũng là đối thủ. Xếp hạng theo số tàu hạ được và vàng.' },
  { id: 'tdm', name: 'Đồng đội', desc: MODES.tdm.desc},
  { id: 'ctf', name: 'Cướp cờ', desc: MODES.ctf.desc },
];

const STORAGE_KEY = 'pirate-battle:menu';
const SEGMENTS = 10;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* bỏ qua */
  }
}

function formatStat(type, key) {
  if (key === 'turnRate') return `${Math.round((type.turnRate * 180) / Math.PI)}°/s`;
  if (key === 'maxSpeed') return `${(type.maxSpeed * 0.8).toFixed(1)} kn`;
  if (key === 'damage') return `${type.damage} × ${type.guns}`;
  return String(type[key]);
}

function statBars(type) {
  return DISPLAY_STATS.map(({ key, label }) => {
    const filled = Math.round(statRatio(type, key) * SEGMENTS);
    const segs = Array.from({ length: SEGMENTS }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('');
    return `<div class="stat"><span class="stat-label">${label}</span><span class="segbar">${segs}</span><span class="stat-val num">${formatStat(type, key)}</span></div>`;
  }).join('');
}

/**
 * Màn hình menu chính: nhập tên thuyền trưởng, chọn số bot, chọn tàu (xem trước 3D ở nền).
 */
export class Menu {
  constructor({ onSelectShip, onStart, onOnline, onCancel, onWarmup, onToggleMusic, onToggleSound, audioState }) {
    this.onToggleMusic = onToggleMusic;
    this.onToggleSound = onToggleSound;
    this.audioState = audioState;
    this.onSelectShip = onSelectShip;
    this.onStart = onStart;
    this.onOnline = onOnline;
    this.onCancel = onCancel;
    this.onWarmup = onWarmup;
    this.busy = false;
    const prefs = loadPrefs();
    const mode = MODES[prefs.mode] ? prefs.mode : DEFAULT_MODE;
    this.state = {
      captain: prefs.captain || 'Thuyền trưởng',
      mode,
      // mục tiêu nhớ riêng cho từng chế độ
      targets: { tdm: MODES.tdm.defaultTarget, ctf: MODES.ctf.defaultTarget, ...(prefs.targets || {}) },
      teamSize: TEAM_SIZE_OPTIONS.includes(prefs.teamSize) ? prefs.teamSize : DEFAULT_TEAM_SIZE,
      shipId: SHIP_TYPES.some((t) => t.id === prefs.shipId) ? prefs.shipId : DEFAULT_SHIP_ID,
      playType: PLAY_TYPES.some((p) => p.id === prefs.playType) ? prefs.playType : 'offline',
      privateBots: NET.privateBotOptions.includes(prefs.privateBots) ? prefs.privateBots : NET.privateBotOptions[1],
      code: '',
      onlineMode: ONLINE_MODES.some((m) => m.id === prefs.onlineMode) ? prefs.onlineMode : 'ffa',
      sideTab: 'ships', // mới vào web luôn mở bảng Chọn tàu trước (không nhớ tab Hướng dẫn)
    };

    this.el = document.getElementById('menu');
    this.el.innerHTML = `
      <div class="menu-panel">
       <div class="m-tabs" role="tablist">
         <button type="button" role="tab" data-mtab="main">Trận đấu</button>
         <button type="button" role="tab" data-mtab="ships">Chọn tàu</button>
         <button type="button" role="tab" data-mtab="guide">Hướng dẫn</button>
       </div>
       <div class="menu-col menu-col-main">
        <header class="menu-head">
          <div class="label">Pirate Battle</div>
          <h1>Cướp biển bắn nhau đùng đùng</h1>
        </header>

        <label class="field">
          <span class="label">Thuyền trưởng</span>
          <input id="captain-input" maxlength="20" autocomplete="off" spellcheck="false" />
        </label>

        <div class="field">
          <span class="label">Kiểu chơi</span>
          <div class="segmented play-types" role="radiogroup">
            ${PLAY_TYPES.map((p) => `<button type="button" role="radio" data-play="${p.id}"><span>${p.name}</span><small>${p.hint}</small></button>`).join('')}
          </div>
        </div>

        <div class="field pane" data-pane="public private">
          <span class="label">Chế độ online</span>
          <div class="segmented" role="radiogroup">
            ${ONLINE_MODES.map((m) => `<button type="button" role="radio" data-omode="${m.id}">${m.name}</button>`).join('')}
          </div>
          <p class="mode-desc" id="omode-desc"></p>
        </div>

        <div class="pane" data-pane="public">
          <p class="pane-text" id="public-text"></p>
        </div>

        <div class="pane" data-pane="private">
          <label class="field" id="otarget-field">
            <span class="label" id="otarget-label">Mục tiêu</span>
            <div class="stepper">
              <button type="button" data-ostep="-1" aria-label="Giảm">−</button>
              <input id="otarget-input" class="num" inputmode="numeric" />
              <button type="button" data-ostep="1" aria-label="Tăng">+</button>
            </div>
          </label>
          <div class="field">
            <span class="label">Tạo phòng riêng · số bot đi kèm</span>
            <div class="create-row">
              <div class="segmented" role="radiogroup">
                ${NET.privateBotOptions.map((n) => `<button type="button" role="radio" data-bots="${n}"><span class="num">${n}</span> bot</button>`).join('')}
              </div>
              <button type="button" class="btn btn-primary" id="create-btn">Tạo phòng riêng</button>
            </div>
          </div>
          <div class="field">
            <span class="label">Vào phòng bằng mã</span>
            <div class="create-row">
              <input id="code-input" class="num code-input" maxlength="6" placeholder="ABCDE" autocomplete="off" spellcheck="false" />
              <button type="button" class="btn" id="join-btn">Vào phòng</button>
            </div>
          </div>
        </div>

        <div class="field pane" data-pane="offline">
          <span class="label">Chế độ chơi</span>
          <div class="segmented seg-2" role="radiogroup">
            ${Object.values(MODES).map((m) => `<button type="button" role="radio" data-mode="${m.id}">${m.name}</button>`).join('')}
          </div>
          <p class="mode-desc" id="mode-desc"></p>
        </div>

        <div class="field-row pane" data-pane="offline">
          <label class="field">
            <span class="label" id="target-label">Mục tiêu</span>
            <div class="stepper">
              <button type="button" data-step="-1" aria-label="Giảm">−</button>
              <input id="target-input" class="num" inputmode="numeric" />
              <button type="button" data-step="1" aria-label="Tăng">+</button>
            </div>
          </label>
          <div class="field">
            <span class="label">Tàu mỗi đội</span>
            <div class="segmented" role="radiogroup">
              ${TEAM_SIZE_OPTIONS.map((n) => `<button type="button" role="radio" data-team="${n}"><span class="num">${n}</span></button>`).join('')}
            </div>
          </div>
        </div>

        <div class="audio-row">
          <button type="button" class="toggle" id="menu-music"></button>
          <button type="button" class="toggle" id="menu-sfx"></button>
        </div>
        <div class="menu-actions">
          <div class="menu-status" id="menu-status" role="status" aria-live="polite"></div>
          <button type="button" class="btn" id="cancel-btn" hidden>Huỷ kết nối</button>
          <button type="button" class="btn btn-primary btn-start" id="start-btn">Ra khơi</button>
          <div class="menu-foot label" id="menu-foot"></div>
        </div>
       </div>

       <div class="menu-col menu-col-side">
        <div class="side-tabs" role="tablist">
          <button type="button" role="tab" data-side="ships">Chọn tàu <span class="num muted">${SHIP_TYPES.length}</span></button>
          <button type="button" role="tab" data-side="guide">Hướng dẫn chơi</button>
        </div>

        <div class="side-pane" data-sidepane="ships">
        <div class="field">
          <div class="ship-list" role="listbox">
            ${SHIP_TYPES.map(
              (t) => `<button type="button" class="ship-row" role="option" data-ship="${t.id}">
                <span class="ship-name">${esc(t.name)}</span>
                <span class="ship-role">${esc(t.role)}</span>              </button>`,
            ).join('')}
          </div>
        </div>

        <div class="ship-detail" id="ship-detail"></div>
        </div>

        <div class="side-pane guide" data-sidepane="guide">${guideHtml()}</div>
       </div>
      </div>`;

    bindGuide(this.el.querySelector('[data-sidepane=guide]'));
    this.captainInput = this.el.querySelector('#captain-input');
    this.captainInput.value = this.state.captain;
    this.captainInput.addEventListener('input', () => {
      this.state.captain = this.captainInput.value;
      savePrefs(this.state);
    });
    this.captainInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // không để W/A/S/D khi gõ tên lọt vào game
      if (e.key === 'Enter') this.start();
    });

    this.statusEl = this.el.querySelector('#menu-status');
    this.cancelBtn = this.el.querySelector('#cancel-btn');
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());
    this.el.querySelector('#menu-music').addEventListener('click', () => this.onToggleMusic?.());
    this.el.querySelector('#menu-sfx').addEventListener('click', () => this.onToggleSound?.());
    this.refreshAudio();
    this.startBtn = this.el.querySelector('#start-btn');
    this.codeInput = this.el.querySelector('#code-input');
    this.codeInput.addEventListener('input', () => {
      const v = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      this.codeInput.value = v;
      this.state.code = v;
    });
    this.codeInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.joinByCode();
    });
    this.el.querySelectorAll('[data-play]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.playType = b.dataset.play;
        this.setStatus('');
        this.render();
        if (this.state.playType !== 'offline') this.onWarmup?.();
      }),
    );
    this.el.querySelectorAll('[data-bots]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.privateBots = Number(b.dataset.bots);
        this.render();
      }),
    );
    this.el.querySelector('#create-btn').addEventListener('click', () => this.online('create'));
    // Tab trên điện thoại: chỉ hiện một cột mỗi lúc (không lưu vào prefs)
    this.mobileTab = 'main';
    this.el.querySelectorAll('[data-mtab]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = b.dataset.mtab;
        this.mobileTab = t === 'main' ? 'main' : 'side';
        if (t !== 'main') this.state.sideTab = t;
        this.render();
      }),
    );
    this.el.querySelectorAll('[data-side]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.sideTab = b.dataset.side;
        this.render();
      }),
    );
    this.el.querySelectorAll('[data-omode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.onlineMode = b.dataset.omode;
        this.render();
      }),
    );
    this.oTargetInput = this.el.querySelector('#otarget-input');
    const setOnlineTarget = (v) => {
      const m = MODES[this.state.onlineMode];
      if (!m) return;
      const n = Math.round(Number(v));
      this.state.targets[m.id] = Number.isFinite(n) ? Math.min(m.max, Math.max(m.min, n)) : m.defaultTarget;
      this.render();
      this.oTargetInput.value = this.state.targets[m.id];
    };
    this.oTargetInput.addEventListener('change', () => setOnlineTarget(this.oTargetInput.value));
    this.oTargetInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') setOnlineTarget(this.oTargetInput.value);
    });
    this.el.querySelectorAll('[data-ostep]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = this.state.onlineMode;
        if (MODES[id]) setOnlineTarget(this.state.targets[id] + Number(b.dataset.ostep));
      }),
    );
    this.el.querySelector('#join-btn').addEventListener('click', () => this.joinByCode());
    this.el.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.mode = b.dataset.mode;
        this.render();
      }),
    );
    this.el.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => {
        this.state.teamSize = Number(b.dataset.team);
        this.render();
      }),
    );
    this.targetInput = this.el.querySelector('#target-input');
    const setTarget = (v) => {
      const m = MODES[this.state.mode];
      const n = Math.round(Number(v));
      this.state.targets[this.state.mode] = Number.isFinite(n) ? Math.min(m.max, Math.max(m.min, n)) : m.defaultTarget;
      this.render();
      this.targetInput.value = this.state.targets[this.state.mode];
    };
    this.targetInput.addEventListener('change', () => setTarget(this.targetInput.value));
    this.targetInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') setTarget(this.targetInput.value);
    });
    this.el.querySelectorAll('[data-step]').forEach((b) =>
      b.addEventListener('click', () => setTarget(this.state.targets[this.state.mode] + Number(b.dataset.step))),
    );
    this.el.querySelectorAll('[data-ship]').forEach((b) =>
      b.addEventListener('click', () => this.selectShip(b.dataset.ship)),
    );
    this.startBtn.addEventListener('click', () => this.primary());

    this.render();
  }

  /** Bề rộng bảng menu (để camera dời tàu xem trước sang phần màn hình còn trống). */
  get panelWidth() {
    return this.el.hidden ? 0 : this.el.querySelector('.menu-panel').offsetWidth;
  }

  /** Mép dưới của bảng menu (px) — dùng khi bảng phủ gần hết chiều ngang (màn dọc). */
  get panelBottom() {
    if (this.el.hidden) return 0;
    const r = this.el.querySelector('.menu-panel').getBoundingClientRect();
    return r.bottom;
  }

  get visible() {
    return !this.el.hidden;
  }

  show() {
    this.el.hidden = false;
    this.onSelectShip?.(this.state.shipId);
  }

  hide() {
    this.el.hidden = true;
  }

  selectShip(id) {
    this.state.shipId = id;
    this.render();
    this.onSelectShip?.(id);
  }

  /** Chọn tàu kế tiếp/trước bằng phím mũi tên. */
  cycleShip(dir) {
    const i = SHIP_TYPES.findIndex((t) => t.id === this.state.shipId);
    const next = SHIP_TYPES[(i + dir + SHIP_TYPES.length) % SHIP_TYPES.length];
    this.selectShip(next.id);
  }

  refreshAudio() {
    const a = this.audioState?.();
    if (!a) return;
    const m = this.el.querySelector('#menu-music');
    const s = this.el.querySelector('#menu-sfx');
    m.textContent = `Nhạc nền: ${a.music ? 'Bật' : 'Tắt'}`;
    s.textContent = `Âm thanh: ${a.sound ? 'Bật' : 'Tắt'}`;
    m.classList.toggle('on', a.music);
    s.classList.toggle('on', a.sound);
  }

  /** Thông báo trạng thái (đang kết nối / lỗi) ở cuối menu. tone: 'error' | 'info' */
  setStatus(text, tone = 'info') {
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
  }

  setBusy(busy, text = '') {
    this.busy = busy;
    this.el.querySelectorAll('button').forEach((b) => (b.disabled = busy));
    this.cancelBtn.hidden = !busy;
    this.cancelBtn.disabled = false; // nút Huỷ luôn bấm được khi đang chờ
    this.statusEl.classList.toggle('waiting', busy);
    if (busy) this.setStatus(text, 'info');
  }

  /** Cập nhật dòng trạng thái khi đang chờ server (Render miễn phí có thể mất ~30–60s để thức dậy). */
  showConnecting(seconds, label) {
    let text;
    if (seconds < 4) text = `${label} Đang kết nối máy chủ…`;
    else if (seconds < 60)
      text = `Đang kết nối máy chủ, vui lòng chờ khoảng 30–60 giây nếu server đang khởi động (máy chủ miễn phí tự ngủ khi không có người chơi)… ${seconds}s`;
    else text = `Máy chủ khởi động lâu hơn bình thường, vẫn đang thử kết nối… ${seconds}s`;
    this.setStatus(text, 'info');
  }

  joinByCode() {
    const code = this.state.code;
    if (!CODE_RE.test(code)) {
      this.setStatus('Mã phòng gồm 4–6 ký tự chữ in hoa / số, ví dụ ABCDE.', 'error');
      this.codeInput.focus();
      return;
    }
    this.online('join');
  }

  online(type) {
    if (this.busy) return;
    savePrefs(this.state);
    this.onOnline?.({
      type,
      code: this.state.code,
      bots: this.state.privateBots,
      mode: this.state.onlineMode,
      target: this.state.targets[this.state.onlineMode],
      name: this.state.captain.trim() || 'Thuyền trưởng',
      shipId: this.state.shipId,
    });
  }

  /** Nút chính / phím Enter: hành động theo kiểu chơi đang chọn. */
  primary() {
    if (this.busy) return;
    if (this.state.playType === 'public') this.online('public');
    else if (this.state.playType === 'private') this.online('create');
    else this.start();
  }

  start() {
    if (this.state.playType !== 'offline') return this.primary();
    const captain = this.state.captain.trim() || 'Thuyền trưởng';
    savePrefs(this.state);
    this.onStart?.({
      captain,
      mode: this.state.mode,
      target: this.state.targets[this.state.mode],
      teamSize: this.state.teamSize,
      shipId: this.state.shipId,
    });
  }

  render() {
    savePrefs(this.state);
    const mark = (sel, attr, value) =>
      this.el.querySelectorAll(sel).forEach((b) => {
        const on = b.dataset[attr] === String(value);
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
      });
    mark('[data-mode]', 'mode', this.state.mode);
    mark('[data-play]', 'play', this.state.playType);
    mark('[data-bots]', 'bots', this.state.privateBots);
    const pt = this.state.playType;
    this.el.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = !p.dataset.pane.split(' ').includes(pt)));
    mark('[data-omode]', 'omode', this.state.onlineMode);
    mark('[data-side]', 'side', this.state.sideTab);
    mark('[data-mtab]', 'mtab', this.mobileTab === 'main' ? 'main' : this.state.sideTab);
    this.el.querySelector('.menu-panel').dataset.mtab = this.mobileTab;
    this.el.querySelectorAll('[data-sidepane]').forEach((p) => (p.hidden = p.dataset.sidepane !== this.state.sideTab));
    const om = ONLINE_MODES.find((m) => m.id === this.state.onlineMode);
    this.el.querySelector('#omode-desc').textContent = om.desc;
    const teamMode = om.id !== 'ffa';
    const pubBots = teamMode ? NET.publicTeamBots : NET.publicBots;
    this.el.querySelector('#public-text').innerHTML = `Tự động ghép vào phòng chung chế độ <strong>${om.name}</strong> đang mở (tối đa <span class="num">${NET.maxPlayers}</span> người, có <span class="num">${pubBots}</span> bot${teamMode ? `, mục tiêu <span class="num">${MODES[om.id].defaultTarget}</span> ${om.id === 'ctf' ? 'cờ' : 'tàu'}` : ''}).`;
    this.el.querySelector('#otarget-field').hidden = !teamMode;
    if (teamMode) {
      const m = MODES[om.id];
      this.el.querySelector('#otarget-label').textContent = `${m.targetLabel} (${m.min}–${m.max})`;
      if (document.activeElement !== this.oTargetInput) this.oTargetInput.value = this.state.targets[om.id];
    }
    this.startBtn.hidden = pt === 'private';
    this.startBtn.textContent = pt === 'public' ? 'Vào phòng chung' : 'Ra khơi';
    this.el.querySelector('#menu-foot').textContent = pt === 'offline' ? 'Enter để ra khơi' : `Online`;
    mark('[data-team]', 'team', this.state.teamSize);
    const m = MODES[this.state.mode];
    this.el.querySelector('#mode-desc').textContent = m.desc;
    this.el.querySelector('#target-label').textContent = `${m.targetLabel} (${m.min}–${m.max})`;
    if (document.activeElement !== this.targetInput) this.targetInput.value = this.state.targets[this.state.mode];
    this.el.querySelectorAll('[data-ship]').forEach((b) => {
      const on = b.dataset.ship === this.state.shipId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    const t = getShipType(this.state.shipId);
    this.el.querySelector('#ship-detail').innerHTML = `
      <div class="detail-head">
        <span class="detail-name">${esc(t.name)}</span>
        <span class="label">${esc(t.role)}</span>
      </div>
      <p class="detail-desc">${esc(t.desc)}</p>
      <div class="stats">${statBars(t)}</div>
      <div class="detail-extra num">Nạp đạn ${t.reload.toFixed(1)}s / mạn · ${t.guns} pháo / mạn</div>`;
  }
}
