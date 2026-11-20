const KEY = 'pirate-battle:career';
const EMPTY = { kills: 0, wins: 0, gold: 0, matches: 0, deaths: 0 };

/** Thống kê cá nhân lâu dài, lưu trong localStorage của trình duyệt. */
export class Career {
  constructor() {
    this.data = { ...EMPTY };
    try {
      this.data = { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
    } catch {
      /* bộ nhớ bị chặn: dùng tạm trong phiên */
    }
    this.el = document.getElementById('career');
    this.render();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* bỏ qua */
    }
    this.render();
  }

  add(field, amount = 1) {
    if (!amount) return;
    this.data[field] = (this.data[field] || 0) + amount;
    this.save();
  }

  setVisible(v) {
    this.el.hidden = !v;
  }

  render() {
    const d = this.data;
    this.el.innerHTML = `
      <div class="label">Thành tích của bạn</div>
      <dl>
        <dt>Tàu đã hạ</dt><dd class="num">${d.kills}</dd>
        <dt>Trận thắng</dt><dd class="num">${d.wins}<span class="muted"> / ${d.matches}</span></dd>
        <dt>Tổng vàng</dt><dd class="num gold">${d.gold}</dd>
      </dl>`;
  }
}
