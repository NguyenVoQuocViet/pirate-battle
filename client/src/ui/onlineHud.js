import { TEAMS } from '../config/game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

/**
 * Giao diện riêng của trận online: thanh mã phòng (copy nhanh) + số người online,
 * bảng xếp hạng trực tiếp, bảng "bị đánh chìm" với nút Hồi sinh ngay / Rời phòng.
 */
export class OnlineHud {
  constructor({ onRespawn, onLeave, toast }) {
    this.bar = document.getElementById('room-bar');
    this.boardEl = document.getElementById('leaderboard');
    this.deathEl = document.getElementById('death');
    this.teamEl = document.getElementById('team-score');
    this.endEl = document.getElementById('match-end');
    this.lastTeam = '';
    this.toast = toast;
    this.lastBoard = '';
    this.lastBar = '';

    this.bar.innerHTML = `
      <span class="label">Phòng</span>
      <span class="room-code num" id="room-code">-----</span>
      <button type="button" class="btn btn-sm" id="copy-code" title="Copy mã phòng">${COPY_ICON}<span>Copy mã</span></button>
      <span class="divider"></span>
      <span class="room-meta" id="room-meta"></span>
      <span class="divider"></span>
      <span class="room-ping num" id="room-ping">Ping: — ms</span>`;
    this.codeEl = this.bar.querySelector('#room-code');
    this.metaEl = this.bar.querySelector('#room-meta');
    this.pingEl = this.bar.querySelector('#room-ping');
    this.bar.querySelector('#copy-code').addEventListener('click', () => this.copyCode());

    this.deathEl.innerHTML = `
      <div class="modal">
        <div class="label">Tàu đã chìm</div>
        <h2 id="death-title">Bị đánh chìm</h2>
        <p class="death-by" id="death-by"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" id="respawn-btn">Hồi sinh ngay</button>
          <button type="button" class="btn" id="leave-btn">Rời phòng</button>
        </div>
      </div>`;
    this.endEl.innerHTML = `
      <div class="modal">
        <div class="label" id="end-mode"></div>
        <h2 id="end-title"></h2>
        <div class="final-score" id="end-score"></div>
        <dl class="summary-table" id="end-stats"></dl>
        <p class="death-by" id="end-reset"></p>
        <div class="modal-actions single">
          <button type="button" class="btn" id="end-leave">Rời phòng</button>
        </div>
      </div>`;
    this.endEl.querySelector('#end-leave').addEventListener('click', () => onLeave?.());
    this.respawnBtn = this.deathEl.querySelector('#respawn-btn');
    this.respawnBtn.addEventListener('click', () => onRespawn?.());
    this.deathEl.querySelector('#leave-btn').addEventListener('click', () => onLeave?.());
  }

  setVisible(v) {
    this.bar.hidden = !v;
    this.boardEl.hidden = !v;
    if (!v) {
      this.teamEl.hidden = true;
      this.hideMatchEnd();
      this.lastTeam = '';
      this.lastBar = '';
      this.lastBoard = '';
    }
    document.body.classList.toggle('online', v);
    if (!v) this.hideDeath();
  }

  async copyCode() {
    const code = this.codeEl.textContent;
    try {
      await navigator.clipboard.writeText(code);
      this.toast?.(`Đã copy mã phòng ${code}`, 'blue');
    } catch {
      // Trình duyệt chặn clipboard (vd trang http qua LAN): chọn sẵn để người dùng tự copy
      const range = document.createRange();
      range.selectNodeContents(this.codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      this.toast?.('Không copy tự động được — mã đã được chọn, nhấn Ctrl+C', 'warn');
    }
  }

  showDeath(byName, environment) {
    this.deathEl.querySelector('#death-title').textContent = environment ? 'Tàu bị đắm' : 'Bị đánh chìm';
    this.deathEl.querySelector('#death-by').innerHTML = environment
      ? `Tàu của bạn đã chìm vì <strong>${esc(byName)}</strong>.`
      : `Thuyền trưởng <strong>${esc(byName)}</strong> đã đánh chìm tàu của bạn.`;
    this.deathEl.hidden = false;
  }

  hideDeath() {
    this.deathEl.hidden = true;
  }

  /** Bảng kết thúc trận (chế độ đội). Phòng tự mở trận mới sau vài giây. */
  showMatchEnd({ winner, scores, target, mode, myTeam, stats }) {
    const win = winner === myTeam;
    this.endEl.querySelector('#end-mode').textContent = `${mode === 'ctf' ? 'Cướp cờ' : 'Đối đầu đồng đội'} · ${win ? 'Chiến thắng' : 'Thất bại'}`;
    this.endEl.querySelector('#end-title').textContent = `Đội ${TEAMS[winner].name} thắng trận!`;
    this.endEl.querySelector('#end-score').innerHTML = `
      <span class="blue"><span class="num">${scores.blue}</span> Xanh</span>
      <span class="muted num">/ ${target} ${mode === 'ctf' ? 'cờ' : 'tàu'}</span>
      <span class="red">Đỏ <span class="num">${scores.red}</span></span>`;
    this.endEl.querySelector('#end-stats').innerHTML = `
      <dt>Đội của bạn</dt><dd>${TEAMS[myTeam].name}</dd>
      <dt>Hạ gục / Bị chìm</dt><dd class="num">${stats.kills} / ${stats.deaths}</dd>
      <dt>Vàng</dt><dd class="num gold">${stats.gold}</dd>`;
    this.endEl.hidden = false;
    this.hideDeath();
  }

  hideMatchEnd() {
    this.endEl.hidden = true;
  }

  update({ roomId, isPrivate, online, isHost, board, myId, canRespawn, mode, modeName, target, scores, myTeam, flagStatus, resetIn, ping }) {
    const pingText = ping ? `Ping: ${ping} ms` : 'Ping: — ms';
    if (this.pingEl.textContent !== pingText) {
      this.pingEl.textContent = pingText;
      this.pingEl.dataset.level = !ping ? '' : ping < 80 ? 'good' : ping < 160 ? 'ok' : 'bad';
    }
    const barKey = `${roomId}|${online}|${isPrivate}|${isHost}|${modeName}`;
    if (barKey !== this.lastBar) {
      this.lastBar = barKey;
      this.codeEl.textContent = roomId;
      this.metaEl.innerHTML = `<span class="online-dot"></span><span class="num">${online}</span> online · ${isPrivate ? 'Phòng riêng' : 'Phòng chung'} · ${esc(modeName)}${isHost ? ' · <span class="muted">Chủ phòng</span>' : ''}`;
    }

    // Tỉ số đội (chỉ chế độ đội)
    const isTeam = mode !== 'ffa';
    this.teamEl.hidden = !isTeam;
    document.body.classList.toggle('online-team', isTeam);
    if (isTeam) {
      const flags = mode === 'ctf' ? flagStatus.map((f) => `${f.team}:${f.lost}`).join(',') : '';
      const key = `${scores.blue}|${scores.red}|${target}|${myTeam}|${flags}`;
      if (key !== this.lastTeam) {
        this.lastTeam = key;
        const flagText =
          mode === 'ctf'
            ? `<div class="ts-flags">${flagStatus
                .map((f) => `<span class="sb-flag ${f.team} ${f.lost ? 'alert' : ''}">${TEAMS[f.team].name}: ${f.lost ? `${f.lost}/${f.total} cờ bị mất` : 'cờ an toàn'}</span>`)
                .join('')}</div>`
            : '';
        this.teamEl.innerHTML = `
          <div class="ts-row">
            <span class="sb-team blue"><span class="sb-name">Xanh</span><span class="num sb-val">${scores.blue}</span></span>
            <span class="sb-target num">/ ${target}</span>
            <span class="sb-team red"><span class="num sb-val">${scores.red}</span><span class="sb-name">Đỏ</span></span>
          </div>
          <div class="ts-me">Bạn thuộc <span class="${myTeam}">đội ${TEAMS[myTeam].name}</span></div>
          ${flagText}`;
      }
    }
    if (!this.endEl.hidden) {
      this.endEl.querySelector('#end-reset').textContent = resetIn > 0 ? `Trận mới bắt đầu sau ${resetIn} giây…` : 'Đang bắt đầu trận mới…';
    }
    this.respawnBtn.disabled = !canRespawn;

    const key = JSON.stringify(board) + myId;
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    const rows = board
      .slice(0, 8)
      .map(
        (b, i) => `<li class="${b.id === myId ? 'me' : ''}">
          <span class="lb-rank num">${i + 1}</span>
          <span class="lb-name">${b.team === 'blue' || b.team === 'red' ? `<i class="lb-team ${b.team}"></i>` : ''}${esc(b.name)}${b.kind === 'bot' ? ' <span class="lb-bot">BOT</span>' : ''}</span>
          <span class="lb-kills num">${b.kills}</span>
          <span class="lb-gold num">${b.gold}</span>
        </li>`,
      )
      .join('');
    this.boardEl.innerHTML = `
      <div class="lb-head"><span class="label">Xếp hạng</span><span class="label">Hạ</span><span class="label">Vàng</span></div>
      <ol>${rows}</ol>`;
  }
}
