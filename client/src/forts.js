import * as THREE from 'three';
import { COMBAT, FORT } from './config/game.js';

export const FORT_MODELS = [
  'tower-complete-large',
  'tower-complete-small',
  'tower-base',
  'tower-middle',
  'tower-middle-windows',
  'tower-top',
  'tower-roof',
  'tower-watch',
  'castle-wall',
  'castle-window',
  'castle-gate',
  'cannon-mobile',
  'flag-pirate-high',
];

const K = 1.4; // tỉ lệ phóng các khối pháo đài
const FIRE_ARC = THREE.MathUtils.degToRad(95); // nửa cung bắn quanh hướng ra biển
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Pháo đài trên đảo. Hai cấp:
 * - "castle" (đảo lớn): 4 tháp góc, tường thành có cổng, 4–6 khẩu pháo.
 * - "outpost" (đảo nhỏ): 1 tháp canh, 2–3 khẩu pháo.
 * Pháo tự xoay nòng về tàu gần nhất (người chơi hoặc bot) và bắn khi vào tầm.
 */
export class Fort {
  constructor(island, models, rand) {
    this.island = island;
    this.guns = [];
    this.tier = island.radius >= FORT.castleMinRadius ? 'castle' : 'outpost';
    this.range = this.tier === 'castle' ? FORT.castleRange : FORT.outpostRange;
    const g = island.group;
    const baseY = island.profile(0, 0, 0) - 0.1;

    const add = (name, x, z, rotY = 0, y = baseY, scale = K) => {
      const src = models[name];
      if (!src) return null;
      const o = src.clone();
      o.position.set(x, y, z);
      o.rotation.y = rotY;
      o.scale.setScalar(scale);
      o.traverse((m) => m.isMesh && (m.castShadow = m.receiveShadow = true));
      g.add(o);
      return o;
    };

    if (this.tier === 'castle') {
      const HALF = island.radius >= 32 ? 8 : 6.6;
      island.fortHalf = HALF + 1.5;
      island.fortTop = 6;
      this.buildCastle(add, HALF, baseY, rand);
    } else {
      island.fortHalf = 2.8;
      island.fortTop = 9;
      this.buildOutpost(add, baseY, rand);
    }

    // --- Các khẩu pháo quanh thành, nòng hướng ra biển ---
    const gunCount = this.tier === 'castle' ? 4 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 2);
    const ringT = this.tier === 'castle' ? 0.62 : 0.5;
    const start = rand() * Math.PI * 2;
    for (let i = 0; i < gunCount; i++) {
      const th = start + (i / gunCount) * Math.PI * 2;
      const r = island.edge(th) * ringT;
      const lx = Math.cos(th) * r;
      const lz = Math.sin(th) * r;
      const ly = island.profile(ringT, lx, lz);
      const pivot = new THREE.Group();
      pivot.position.set(lx, ly, lz);
      pivot.rotation.y = Math.atan2(lx, lz); // quay ra ngoài
      g.add(pivot);
      const src = models['cannon-mobile'];
      if (src) {
        const c = src.clone();
        c.scale.setScalar(1.9);
        c.traverse((m) => m.isMesh && (m.castShadow = true));
        pivot.add(c);
      }
      this.guns.push({
        pivot,
        world: new THREE.Vector3(island.x + lx, ly, island.z + lz),
        reload: 1 + rand() * FORT.reloadMax,
        yaw: pivot.rotation.y,
        outward: pivot.rotation.y,
      });
    }
    this.ringRadius = island.radius * ringT;
  }

  buildCastle(add, HALF, baseY, rand) {
    const corners = [
      [-HALF, -HALF],
      [HALF, -HALF],
      [HALF, HALF],
      [-HALF, HALF],
    ];
    corners.forEach(([x, z], i) => {
      if (i % 2 === 0) {
        add('tower-complete-large', x, z, rand() * 6.28);
      } else {
        add('tower-base', x, z);
        add('tower-middle-windows', x, z, rand() * 6.28, baseY + 2 * K);
        add('tower-top', x, z, 0, baseY + 4 * K);
        add('tower-roof', x, z, 0, baseY + 4 * K + 2.2 * K);
      }
    });
    add('flag-pirate-high', -HALF, -HALF, 0.6, baseY + 10.1 * K, K * 1.1);

    // Tường thành giữa các tháp; cổng ở mặt nam (+Z, hướng về camera)
    const seg = 2 * K;
    const n = Math.max(2, Math.round((2 * HALF - 5) / seg));
    const offsets = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * seg);
    const hasGate = n >= 4;
    const sides = [
      { dir: 'x', fixed: -HALF, rot: 0 },
      { dir: 'x', fixed: HALF, rot: Math.PI, gate: hasGate },
      { dir: 'z', fixed: -HALF, rot: Math.PI / 2 },
      { dir: 'z', fixed: HALF, rot: -Math.PI / 2 },
    ];
    const mid = [Math.floor((n - 1) / 2), Math.ceil((n - 1) / 2)];
    for (const s of sides) {
      offsets.forEach((o, i) => {
        if (s.gate && mid.includes(i)) return;
        const name = i % 2 === 0 ? 'castle-wall' : 'castle-window';
        if (s.dir === 'x') add(name, o, s.fixed, s.rot);
        else add(name, s.fixed, o, s.rot);
      });
      if (s.gate) add('castle-gate', 0, s.fixed, s.rot);
    }
  }

  buildOutpost(add, baseY, rand) {
    if (rand() < 0.5) {
      add('tower-complete-small', 0, 0, rand() * 6.28);
      add('flag-pirate-high', 0, 0, 0.6, baseY + 6.7 * K, K);
    } else {
      // Tháp canh lắp ghép: chân có cửa + thân + chòi canh
      add('tower-base', 0, 0, rand() * 6.28);
      add('tower-middle', 0, 0, rand() * 6.28, baseY + 2 * K);
      add('tower-watch', 0, 0, rand() * 6.28, baseY + 4 * K);
      add('flag-pirate-high', 0, 0, 0.6, baseY + 6.7 * K, K);
    }
  }

  get x() {
    return this.island.x;
  }
  get z() {
    return this.island.z;
  }
  /** Bán kính vùng nguy hiểm (từ tâm đảo) để vẽ lên minimap / cho AI né. */
  get dangerRadius() {
    return this.ringRadius + this.range;
  }

  update(dt, ships, projectiles, effects) {
    for (const gun of this.guns) {
      gun.reload -= dt;

      // Tìm tàu gần nhất còn sống nằm trong cung bắn
      let target = null;
      let best = this.range * 1.4;
      for (const s of ships) {
        if (s.sunk) continue;
        const dx = s.position.x - gun.world.x;
        const dz = s.position.z - gun.world.z;
        const d = Math.hypot(dx, dz);
        if (d >= best) continue;
        if (Math.abs(wrap(Math.atan2(dx, dz) - gun.outward)) > FIRE_ARC) continue;
        best = d;
        target = s;
      }
      if (!target) continue;

      const sp = target.position;
      const dx = sp.x - gun.world.x;
      const dz = sp.z - gun.world.z;
      const dist = best;
      const offArc = wrap(Math.atan2(dx, dz) - gun.outward);
      const aimYaw = gun.outward + THREE.MathUtils.clamp(offArc, -FIRE_ARC, FIRE_ARC);
      gun.yaw += wrap(aimYaw - gun.yaw) * (1 - Math.exp(-3 * dt));
      gun.pivot.rotation.y = gun.yaw;

      if (dist > this.range || gun.reload > 0) continue;
      gun.reload = FORT.reloadMin + Math.random() * (FORT.reloadMax - FORT.reloadMin);

      // Ngắm đón đầu theo vận tốc tàu, giải quỹ đạo parabol với thời gian bay T
      const muzzle = gun.world.clone().add(new THREE.Vector3(Math.sin(gun.yaw) * 2.6, 1.6, Math.cos(gun.yaw) * 2.6));
      const T = THREE.MathUtils.clamp(dist / 30, 0.9, 3);
      const aim = sp
        .clone()
        .addScaledVector(target.velocity, T)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2 * FORT.spread, 1.5, (Math.random() - 0.5) * 2 * FORT.spread));
      const d = aim.sub(muzzle);
      const g = COMBAT.gravity;
      const vel = new THREE.Vector3(d.x / T, (d.y + 0.5 * g * T * T) / T, d.z / T);
      projectiles.launch(muzzle, vel, { kind: 'fort', damage: COMBAT.fortDamage });
      effects.muzzle(muzzle, vel.clone().normalize(), new THREE.Vector3());
    }
  }
}
