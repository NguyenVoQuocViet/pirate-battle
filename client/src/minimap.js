import { GRASS_T } from './islands.js';
import { TEAMS, PLAYER_TEAM } from './config/game.js';

const MIN_RANGE = 60; // bán kính thế giới hiển thị khi phóng to nhất
const MAX_RANGE = 700; // khi thu nhỏ nhất

/**
 * Minimap ở dưới giữa màn hình.
 * - Chế độ nhỏ: tròn, lấy tàu làm tâm.
 * - Chế độ lớn (phím M): vuông, giữa màn hình, nhìn toàn bộ vùng biển.
 * Hướng bắc (-Z thế giới) luôn ở trên, trùng hướng camera.
 */
export class Minimap {
  constructor({ islands, projectiles }) {
    this.ship = null; // tàu người chơi (tâm minimap)
    this.ships = []; // mọi tàu: đồng đội xanh, địch đỏ
    this.loots = []; // rương / thùng -> ô vàng
    this.strongholds = [];
    this.depots = [];
    this.flags = [];
    this.islands = islands;
    this.projectiles = projectiles;
    this.expanded = false;
    // mỗi chế độ nhớ mức zoom riêng
    this.ranges = { small: 200, big: islands.worldRadius + 70 };
    this.range = this.ranges.small;

    this.root = document.getElementById('minimap');
    this.canvas = this.root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.label = this.root.querySelector('.mm-scale');

    this.root.querySelector('.mm-in').addEventListener('click', () => this.zoomBy(1 / 1.4));
    this.root.querySelector('.mm-out').addEventListener('click', () => this.zoomBy(1.4));
    this.root.querySelector('.mm-toggle').addEventListener('click', () => this.toggle());
    this.root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.zoomBy(Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );
    // Không để click trên minimap lọt xuống canvas game (tránh bắn nhầm)
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('pointerup', (e) => e.stopPropagation());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get mode() {
    return this.expanded ? 'big' : 'small';
  }

  zoomBy(f) {
    const max = this.expanded ? MAX_RANGE * 1.5 : MAX_RANGE;
    this.ranges[this.mode] = Math.min(max, Math.max(MIN_RANGE, this.ranges[this.mode] * f));
  }

  toggle() {
    this.expanded = !this.expanded;
    this.root.classList.toggle('expanded', this.expanded);
    this.range = this.ranges[this.mode];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.canvas.clientWidth;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.dpr = dpr;
  }

  setEntities({ ship, ships = [], loots = [], strongholds = [], depots = [], flags = [] }) {
    Object.assign(this, { ship, ships, loots, strongholds, depots, flags });
  }

  update(dt) {
    if (!this.ship) return;
    // Canvas có thể được tạo khi đang ẩn (kích thước 0) -> đo lại khi hiện ra
    const want = Math.round(this.canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
    if (want > 0 && this.canvas.width !== want) this.resize();
    this.range += (this.ranges[this.mode] - this.range) * (1 - Math.exp(-10 * dt));
    this.draw();
  }

  draw() {
    const { ctx, canvas, ship, dpr } = this;
    const W = canvas.width;
    const R = W / 2;
    const scale = R / this.range; // pixel trên mỗi đơn vị thế giới
    // Bản đồ lớn lấy tâm thế giới làm gốc; minimap nhỏ lấy tàu làm tâm
    const cx = this.expanded ? 0 : ship.position.x;
    const cz = this.expanded ? 0 : ship.position.z;
    const toMap = (x, z) => [R + (x - cx) * scale, R + (z - cz) * scale];

    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    if (this.expanded) ctx.rect(0, 0, W, W);
    else ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();

    // Nền biển
    ctx.fillStyle = '#16557a';
    ctx.fillRect(0, 0, W, W);

    // Lưới toạ độ
    const grid = this.range > 450 ? 200 : this.range > 150 ? 100 : 50;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    const x0 = Math.floor((cx - this.range) / grid) * grid;
    const z0 = Math.floor((cz - this.range) / grid) * grid;
    for (let x = x0; x <= cx + this.range; x += grid) {
      const [px] = toMap(x, 0);
      ctx.moveTo(px, 0);
      ctx.lineTo(px, W);
    }
    for (let z = z0; z <= cz + this.range; z += grid) {
      const [, pz] = toMap(0, z);
      ctx.moveTo(0, pz);
      ctx.lineTo(W, pz);
    }
    ctx.stroke();

    // Vùng nguy hiểm của pháo đài
    for (const f of this.islands.forts) {
      const [fx, fz] = toMap(f.x, f.z);
      ctx.beginPath();
      ctx.arc(fx, fz, f.dangerRadius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(230,60,40,0.10)';
      ctx.fill();
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.strokeStyle = 'rgba(255,90,70,0.7)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Đảo: viền nước nông, cát, cỏ
    for (const isl of this.islands.list) {
      const [ix, iz] = toMap(isl.x, isl.z);
      const rr = isl.radius * 1.4 * scale;
      if (ix + rr < 0 || ix - rr > W || iz + rr < 0 || iz - rr > W) continue;
      this.islandPath(isl, 1.15, toMap);
      ctx.fillStyle = 'rgba(120,200,210,0.35)';
      ctx.fill();
      this.islandPath(isl, 1.0, toMap);
      ctx.fillStyle = '#e8d29a';
      ctx.fill();
      this.islandPath(isl, GRASS_T, toMap);
      ctx.fillStyle = '#5f9e47';
      ctx.fill();
    }

    // Biểu tượng pháo đài (lâu đài nhỏ)
    for (const f of this.islands.forts) {
      const [fx, fz] = toMap(f.x, f.z);
      const s = Math.max(5 * dpr, Math.min(12 * dpr, f.island.fortHalf * scale));
      ctx.fillStyle = '#6b6f8a';
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.rect(fx - s, fz - s * 0.6, s * 2, s * 1.4);
      for (let i = -1; i <= 1; i++) ctx.rect(fx + i * s * 0.8 - s * 0.2, fz - s * 0.95, s * 0.4, s * 0.4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d33';
      ctx.fillRect(fx - s * 0.15, fz - s * 1.6, s * 0.7, s * 0.4);
    }

    // Rương kho báu
    for (const l of this.loots) {
      const [lx, lz] = toMap(l.position.x, l.position.z);
      ctx.fillStyle = '#ffc400';
      ctx.strokeStyle = '#3a2a00';
      ctx.lineWidth = dpr;
      const ls = 3 * dpr;
      ctx.beginPath();
      ctx.rect(lx - ls, lz - ls, ls * 2, ls * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Cứ điểm (ô vuông màu đội + vòng vùng chạm)
    for (const h of this.strongholds) {
      const [hx, hz] = toMap(h.x, h.z);
      const col = TEAMS[h.team].css;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(hx, hz, Math.max(4 * dpr, h.zoneRadius * scale), 0, Math.PI * 2);
      ctx.stroke();
      const hs = 4 * dpr;
      ctx.fillStyle = col;
      ctx.fillRect(hx - hs, hz - hs, hs * 2, hs * 2);
      ctx.strokeStyle = '#0b0b0c';
      ctx.lineWidth = dpr;
      ctx.strokeRect(hx - hs, hz - hs, hs * 2, hs * 2);
    }

    // Tháp tiếp đạn (vòng trắng có chấm giữa)
    for (const d of this.depots) {
      const [dx, dz] = toMap(d.x, d.z);
      const r = Math.max(5 * dpr, d.zoneRadius * scale);
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.arc(dx, dz, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath();
      ctx.arc(dx, dz, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cờ (tam giác màu đội; viền trắng nếu đang bị mang đi)
    for (const f of this.flags) {
      const p = f.position;
      const [fx, fz] = toMap(p.x, p.z);
      const fs = 5 * dpr;
      ctx.fillStyle = TEAMS[f.team].css;
      ctx.strokeStyle = f.state === 'home' ? '#0b0b0c' : '#ffffff';
      ctx.lineWidth = (f.state === 'home' ? 1 : 2) * dpr;
      ctx.beginPath();
      ctx.moveTo(fx, fz - fs * 2);
      ctx.lineTo(fx + fs * 1.6, fz - fs * 1.4);
      ctx.lineTo(fx, fz - fs * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx, fz - fs * 2);
      ctx.lineTo(fx, fz);
      ctx.stroke();
    }

    // Tàu: đồng đội xanh, địch đỏ, có vạch chỉ hướng
    for (const b of this.ships) {
      if (b.sunk || b === this.ship) continue;
      const ally = b.team === 'blue';
      const [bx, bz] = toMap(b.position.x, b.position.z);
      const r = (this.expanded ? 5 : 4) * dpr;
      ctx.strokeStyle = ally ? '#8cbcff' : '#ff6b5a';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(bx, bz);
      ctx.lineTo(bx + Math.sin(b.heading) * r * 2.2, bz + Math.cos(b.heading) * r * 2.2);
      ctx.stroke();
      ctx.fillStyle = ally ? TEAMS.blue.css : TEAMS.red.css;
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(bx, bz, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Đạn đang bay (đỏ = của địch)
    for (const b of this.projectiles.balls) {
      const [bx, bz] = toMap(b.mesh.position.x, b.mesh.position.z);
      ctx.fillStyle = b.owner?.team === PLAYER_TEAM ? '#ffb347' : '#ff5040';
      ctx.beginPath();
      ctx.arc(bx, bz, 1.8 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tàu người chơi (mũi tên theo hướng mũi tàu)
    const [sx, sz] = toMap(ship.position.x, ship.position.z);
    const ang = Math.atan2(Math.cos(ship.heading), Math.sin(ship.heading));
    const s = (this.expanded ? 9 : 7) * dpr;
    ctx.translate(sx, sz);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(s * 1.4, 0);
    ctx.lineTo(-s, s * 0.8);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(-s, -s * 0.8);
    ctx.closePath();
    ctx.fillStyle = ship.sunk ? '#888' : '#ffffff';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1.5 * dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Mũi tên hướng gió trên viền (chỉ chiều gió thổi tới)
    if (this.windAngle !== undefined) {
      const wx = Math.sin(this.windAngle);
      const wz = Math.cos(this.windAngle);
      const rim = this.expanded ? R * 0.9 : R - 12 * dpr;
      const ax = R + wx * rim;
      const az = R + wz * rim;
      const ang = Math.atan2(wz, wx);
      ctx.save();
      ctx.translate(ax, az);
      ctx.rotate(ang);
      const a = 7 * dpr;
      ctx.beginPath();
      ctx.moveTo(a, 0);
      ctx.lineTo(-a * 0.8, a * 0.7);
      ctx.lineTo(-a * 0.3, 0);
      ctx.lineTo(-a * 0.8, -a * 0.7);
      ctx.closePath();
      ctx.fillStyle = '#e8f4ff';
      ctx.strokeStyle = '#0b0b0c';
      ctx.lineWidth = dpr;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = 'rgba(232,244,255,0.85)';
      ctx.font = `600 ${9 * dpr}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GIÓ', R + wx * (rim - 16 * dpr), R + wz * (rim - 16 * dpr));
      ctx.restore();
    }

    // Chữ N (hướng bắc) ở mép trên
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 ${(this.expanded ? 14 : 11) * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', R, 5 * dpr);
    ctx.restore();

    this.label.textContent = `${Math.round(this.range * 2)} m`;
  }

  islandPath(isl, t, toMap) {
    const ctx = this.ctx;
    ctx.beginPath();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = isl.edge(th) * t;
      const [px, pz] = toMap(isl.x + Math.cos(th) * r, isl.z + Math.sin(th) * r);
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.closePath();
  }
}
