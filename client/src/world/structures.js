import * as THREE from 'three';
import { TEAMS, STRONGHOLD, AMMO } from '../config/game.js';

export const STRUCTURE_MODELS = [
  'structure-platform',
  'flag-high',
  'flag',
  'tower-complete-small',
  'tower-base',
  'tower-middle-windows',
  'tower-watch',
  'barrel',
  'crate',
];

/** Clone mô hình và nhuộm màu (dùng cho cờ / chi tiết theo màu đội). */
export function tinted(src, color, amount = 0.8) {
  const o = src.clone();
  const c = new THREE.Color(0xffffff).lerp(new THREE.Color(color), amount);
  o.traverse((m) => {
    if (!m.isMesh) return;
    m.material = m.material.clone();
    m.material.color = c;
  });
  return o;
}

function place(group, src, x, y, z, scale, rotY = 0) {
  if (!src) return null;
  const o = src.clone();
  o.position.set(x, y, z);
  o.scale.setScalar(scale);
  o.rotation.y = rotY;
  o.traverse((m) => m.isMesh && (m.castShadow = m.receiveShadow = true));
  group.add(o);
  return o;
}

function zoneRing(radius, color, opacity) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.7, radius, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.7;
  return ring;
}

/** Trụ chung: nền gỗ nổi + vòng vùng chạm. */
class Structure {
  constructor(scene, x, z, zoneRadius, coreRadius) {
    this.x = x;
    this.z = z;
    this.zoneRadius = zoneRadius;
    this.coreRadius = coreRadius;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.phase = Math.random() * 10;
  }

  get position() {
    return this.group.position;
  }

  contains(pos, pad = 0) {
    return Math.hypot(pos.x - this.x, pos.z - this.z) < this.zoneRadius + pad;
  }

  /** Đẩy tàu ra khỏi trụ ở giữa (không mất máu). */
  collide(ship) {
    const dx = ship.position.x - this.x;
    const dz = ship.position.z - this.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const min = this.coreRadius + ship.radius * 0.6;
    if (d < min) {
      ship.position.x = this.x + (dx / d) * min;
      ship.position.z = this.z + (dz / d) * min;
      ship.speed *= 0.8;
    }
  }

  update(time) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2 + this.phase);
    this.ring.material.opacity = this.baseOpacity * (0.6 + 0.4 * pulse);
  }
}

/** Cứ điểm của một đội: nơi hồi sinh, giữ cờ (chế độ Cướp cờ). */
export class Stronghold extends Structure {
  constructor(scene, models, def) {
    super(scene, def.x, def.z, STRONGHOLD.zoneRadius, STRONGHOLD.coreRadius);
    this.id = def.id;
    this.team = def.team;
    const color = TEAMS[def.team].color;
    const g = this.group;
    place(g, models['structure-platform'], 0, -1.2, 0, 3.4);
    place(g, models['tower-complete-small'], 0, 1.6, 0, 1.25, Math.random() * 6.28);
    // Băng rôn màu đội trên đỉnh tháp
    const banner = models['flag-high'] ? tinted(models['flag-high'], color, 0.85) : null;
    if (banner) {
      banner.position.set(0, 1.6 + 6.7 * 1.25, 0);
      banner.scale.setScalar(1.3);
      g.add(banner);
    }
    this.flagHome = new THREE.Vector3(def.x + 4.2, 1.6, def.z + 4.2); // chỗ cắm cờ để cướp
    this.ring = zoneRing(this.zoneRadius, color, 0.55);
    this.baseOpacity = 0.55;
    g.add(this.ring);
  }
}

/** Tháp tiếp đạn trung lập. */
export class AmmoDepot extends Structure {
  constructor(scene, models, def) {
    super(scene, def.x, def.z, AMMO.depotRadius, AMMO.coreRadius);
    this.id = def.id;
    const g = this.group;
    const K = 1.2;
    place(g, models['structure-platform'], 0, -1.2, 0, 3);
    place(g, models['tower-base'], 0, 1.5, 0, K);
    place(g, models['tower-middle-windows'], 0, 1.5 + 2 * K, 0, K, 1.2);
    place(g, models['tower-watch'], 0, 1.5 + 4 * K, 0, K);
    // Thùng thuốc súng quanh chân tháp
    const props = [
      ['barrel', 2.6, 1.8, 1.4],
      ['barrel', -2.4, 2.2, 1.4],
      ['crate', 2.2, -2.6, 1.6],
      ['crate', -2.8, -1.8, 1.6],
    ];
    for (const [name, x, z, s] of props) place(g, models[name], x, 1.5, z, s, Math.random() * 6.28);
    this.ring = zoneRing(this.zoneRadius, 0xf2f2f2, 0.6);
    this.baseOpacity = 0.6;
    g.add(this.ring);
  }
}
