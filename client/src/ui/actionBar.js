import { UPGRADES, SKILL, BUFFS } from '../config/game.js';

const ICONS = {
  hull: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3z"/><path d="M12 8v8M8 12h8"/></svg>',
  powder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="6"/><path d="m14 10 3-3M17 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg>',
  crew: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c2.8 0 5 2.2 5 5"/></svg>',
  sails: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v15M12 4c4 2 6 6 6 11h-6M12 6c-3 2-5 5-5 9h5M4 19h16l-2 2H6z"/></svg>',
  boost: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/></svg>',
};

/**
 * Thanh nâng cấp (phím 1–4) bên trái minimap + kỹ năng lướt sóng (E/Shift) và buff đang có
 * bên phải minimap. Bấm/chạm trực tiếp được.
 */
export class ActionBar {
  constructor({ onUpgrade, onBoost }) {
    this.upEl = document.getElementById('upgrades');
    this.abEl = document.getElementById('abilities');
    this.upEl.innerHTML = `
      <div class="up-head"><span class="label">Nâng cấp</span><span class="up-gold num" id="up-gold">0</span></div>
      <div class="up-cells">
        ${UPGRADES.branches
          .map(
            (b, i) => `<button type="button" class="up-cell" data-up="${i}" title="${b.name}: ${b.effect}">
              <span class="up-top"><kbd>${b.key}</kbd><span class="up-icon">${ICONS[b.id]}</span></span>
              <span class="up-name">${b.short}</span>
              <span class="up-pips">${'<i></i>'.repeat(UPGRADES.maxLevel)}</span>
              <span class="up-cost num"></span>
            </button>`,
          )
          .join('')}
      </div>`;
    this.cells = [...this.upEl.querySelectorAll('.up-cell')];
    this.cells.forEach((c) => {
      c.addEventListener('pointerdown', (e) => e.stopPropagation());
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        onUpgrade?.(Number(c.dataset.up));
      });
    });
    this.goldEl = this.upEl.querySelector('#up-gold');

    this.abEl.innerHTML = `
      <button type="button" class="skill" id="skill-btn" title="${SKILL.name} (E / Shift): +${Math.round(SKILL.speedBonus * 100)}% tốc độ trong ${SKILL.duration}s">
        <svg class="skill-ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" class="ring-bg"/><circle cx="24" cy="24" r="21" class="ring-fg" id="skill-ring"/></svg>
        <span class="skill-icon">${ICONS.boost}</span>
        <span class="skill-cd num" id="skill-cd"></span>
        <kbd class="skill-key">E</kbd>
      </button>
      <div class="buffs" id="buffs"></div>`;
    this.skillBtn = this.abEl.querySelector('#skill-btn');
    this.skillBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.skillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onBoost?.();
    });
    this.ring = this.abEl.querySelector('#skill-ring');
    this.cdEl = this.abEl.querySelector('#skill-cd');
    this.buffsEl = this.abEl.querySelector('#buffs');
    this.circ = 2 * Math.PI * 21;
    this.ring.style.strokeDasharray = `${this.circ}`;
    this.lastKey = '';
  }

  setVisible(v) {
    this.upEl.hidden = !v;
    this.abEl.hidden = !v;
  }

  /** Nháy ô nâng cấp vừa mua / không đủ vàng. */
  flash(index, ok) {
    const c = this.cells[index];
    if (!c) return;
    c.classList.remove('flash-ok', 'flash-no');
    void c.offsetWidth;
    c.classList.add(ok ? 'flash-ok' : 'flash-no');
  }

  update(ship, gold) {
    if (!ship) return;
    // Nâng cấp
    const key = `${gold}|${Object.values(ship.upgrades).join(',')}|${ship.sunk}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.goldEl.textContent = gold;
      UPGRADES.branches.forEach((b, i) => {
        const lvl = ship.upgrades[b.id];
        const c = this.cells[i];
        const maxed = lvl >= UPGRADES.maxLevel;
        const cost = maxed ? 0 : UPGRADES.costs[lvl];
        c.querySelectorAll('.up-pips i').forEach((pip, k) => pip.classList.toggle('on', k < lvl));
        c.querySelector('.up-cost').textContent = maxed ? 'TỐI ĐA' : cost;
        c.classList.toggle('maxed', maxed);
        c.classList.toggle('affordable', !maxed && gold >= cost && !ship.sunk);
        c.disabled = false;
      });
    }

    // Kỹ năng
    const cd = ship.boostCooldown;
    const active = ship.boostTime > 0;
    const frac = active ? ship.boostTime / SKILL.duration : cd > 0 ? 1 - cd / SKILL.cooldown : 1;
    this.ring.style.strokeDashoffset = `${this.circ * (1 - frac)}`;
    this.skillBtn.classList.toggle('ready', cd <= 0 && !ship.sunk);
    this.skillBtn.classList.toggle('active', active);
    this.cdEl.textContent = !active && cd > 0 ? Math.ceil(cd) : '';

    // Buff đang có
    const buffs = Object.entries(ship.buffs).filter(([, t]) => t > 0);
    this.buffsEl.innerHTML = buffs
      .map(([id, t]) => {
        const b = BUFFS.kinds[id];
        return `<div class="buff" style="--buff:${b.css}"><span class="buff-name">${b.name}</span><span class="buff-bar"><i style="width:${(t / BUFFS.duration) * 100}%"></i></span><span class="num buff-t">${Math.ceil(t)}s</span></div>`;
      })
      .join('');
  }
}
