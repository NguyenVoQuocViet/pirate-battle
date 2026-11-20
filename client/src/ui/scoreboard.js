import { TEAMS } from '../config/game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Bảng xếp hạng đầy đủ khi giữ phím Tab (chơi đơn và online).
 * data: { title, sub, teamMode, scores, target, unit, rows: [{ name, team, kills, deaths, gold, isMe, isBot, alive, carrying }] }
 */
export class Scoreboard {
  constructor() {
    this.el = document.getElementById('scoreboard');
    this.visible = false;
    this.lastKey = '';
  }

  show() {
    this.visible = true;
    this.el.hidden = false;
  }

  hide() {
    this.visible = false;
    this.el.hidden = true;
    this.lastKey = '';
  }

  update(data) {
    if (!this.visible || !data) return;
    const key = JSON.stringify(data);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const sort = (rows) => rows.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (b.gold ?? 0) - (a.gold ?? 0));
    const table = (rows) => `
      <table class="sb-table">
        <thead><tr><th class="c-rank">#</th><th>Thuyền trưởng</th><th class="c-num">Hạ</th><th class="c-num">Chìm</th><th class="c-num">Vàng</th></tr></thead>
        <tbody>
          ${sort(rows)
            .map(
              (r, i) => `<tr class="${r.isMe ? 'me' : ''} ${r.alive ? '' : 'dead'}">
                <td class="c-rank num">${i + 1}</td>
                <td class="c-name">${esc(r.name)}${r.isBot ? ' <span class="lb-bot">BOT</span>' : ''}${r.carrying ? ' <span class="sb-carry">cờ</span>' : ''}${r.alive ? '' : ' <span class="sb-dead">chìm</span>'}</td>
                <td class="c-num num">${r.kills}</td>
                <td class="c-num num">${r.deaths}</td>
                <td class="c-num num gold">${r.gold ?? '—'}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;

    let body;
    if (data.teamMode) {
      body = `<div class="sb-cols">${['blue', 'red']
        .map(
          (team) => `<div class="sb-col">
            <div class="sb-col-head ${team}"><span>Đội ${TEAMS[team].name}</span><span class="num">${data.scores[team]}</span></div>
            ${table(data.rows.filter((r) => r.team === team))}
          </div>`,
        )
        .join('')}</div>`;
    } else {
      body = table(data.rows);
    }

    this.el.innerHTML = `
      <div class="sb-panel">
        <div class="sb-head">
          <div><div class="label">${esc(data.sub || '')}</div><h2>${esc(data.title)}</h2></div>
          ${data.teamMode ? `<div class="sb-score num"><span class="blue">${data.scores.blue}</span> : <span class="red">${data.scores.red}</span><span class="muted"> / ${data.target} ${esc(data.unit)}</span></div>` : ''}
        </div>
        ${body}
        <div class="label muted sb-foot">Thả Tab để đóng</div>
      </div>`;
  }
}
