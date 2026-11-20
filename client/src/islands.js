import * as THREE from 'three';
import { Fort, FORT_MODELS } from './forts.js';
import { WORLD, FORT, STRONGHOLDS, STRONGHOLD, AMMO_DEPOTS, AMMO } from './config/game.js';

/** Khu vực cấm sinh đảo: cứ điểm các đội và tháp tiếp đạn. */
const RESERVED = [
  ...STRONGHOLDS.map((s) => ({ x: s.x, z: s.z, r: STRONGHOLD.reserve })),
  ...AMMO_DEPOTS.map((d) => ({ x: d.x, z: d.z, r: AMMO.reserve })),
];

// RNG có seed để bản đồ đảo luôn giống nhau (tiện cho chế độ nhiều người chơi sau này).
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bản đồ mặc định (chơi đơn). Phòng online dùng mapSeed riêng do server cấp. */
export const DEFAULT_MAP_SEED = 1337;

const RINGS = [0, 0.12, 0.25, 0.38, 0.5, 0.6, 0.7, 0.78, 0.86, 0.93, 1.0, 1.08, 1.2];
const SEGMENTS = 48;
const BEACH_H = 0.5; // độ cao bờ cát ở mép đảo (t = 1)
const GRASS_T = 0.72; // trong vòng này là cỏ, ngoài là cát

const SAND = new THREE.Color(0xe3c98a);
const SAND_WET = new THREE.Color(0xc8ad72);
const GRASS = new THREE.Color(0x6aa84f);
const GRASS_DARK = new THREE.Color(0x4f8a3c);

/** Một hòn đảo: hình dạng méo ngẫu nhiên, mép cát, giữa phủ cỏ. */
class Island {
  constructor(x, z, radius, height, rand, fort = false) {
    this.fort = fort; // đảo pháo đài: tròn hơn, mặt phẳng ở giữa để xây thành
    this.fortHalf = 0; // nửa cạnh khối công trình (Fort gán khi xây)
    this.fortTop = 6; // chiều cao công trình chặn đạn
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.height = height;
    // Hệ số méo theo góc (tuần hoàn để không bị nứt ở đường nối)
    const m = fort ? 0.4 : 1;
    this.shape = [
      [2, rand() * 6.28, (0.08 + rand() * 0.1) * m],
      [3, rand() * 6.28, (0.06 + rand() * 0.08) * m],
      [5, rand() * 6.28, (0.03 + rand() * 0.04) * m],
    ];
    this.bumpSeed = rand() * 100;
  }

  /** Bán kính mép đảo (t = 1) theo góc. */
  edge(theta) {
    let f = 1;
    for (const [k, ph, a] of this.shape) f += a * Math.sin(k * theta + ph);
    return this.radius * f;
  }

  /** Độ cao theo tỉ lệ khoảng cách t (0 = tâm, 1 = mép). */
  profile(t, lx, lz) {
    if (t > 1) return BEACH_H - ((t - 1) / 0.2) * (BEACH_H + 3.5);
    const s = THREE.MathUtils.smoothstep(t, this.fort ? 0.5 : 0.3, 1.0); // 0 ở cao nguyên, 1 ở mép
    let h = this.height - (this.height - BEACH_H) * s;
    // gợn đồi nhẹ ở phần trong (đảo pháo đài giữ phẳng)
    if (t < 0.85 && !this.fort) {
      const b = this.bumpSeed;
      h += (Math.sin(lx * 0.21 + b) * Math.cos(lz * 0.17 - b) * 0.6 + Math.sin(lx * 0.53 - lz * 0.41 + b) * 0.25) * (1 - t / 0.85);
    }
    return h;
  }

  /** Toạ độ cực: trả về t (tỉ lệ so với mép) của điểm thế giới. */
  tAt(wx, wz) {
    const dx = wx - this.x;
    const dz = wz - this.z;
    return Math.hypot(dx, dz) / this.edge(Math.atan2(dz, dx));
  }

  /** Độ cao mặt đất tại điểm thế giới, hoặc -Infinity nếu ngoài đảo. */
  heightAt(wx, wz) {
    const t = this.tAt(wx, wz);
    if (t > 1.2) return -Infinity;
    const lx = wx - this.x;
    const lz = wz - this.z;
    let h = this.profile(t, lx, lz);
    // Tường thành / tháp chặn đạn
    if (this.fort && Math.abs(lx) < this.fortHalf && Math.abs(lz) < this.fortHalf) h += this.fortTop;
    return h;
  }

  buildMesh() {
    const pos = [];
    const col = [];
    const idx = [];
    const c = new THREE.Color();
    // tâm
    pos.push(0, this.profile(0, 0, 0), 0);
    col.push(GRASS.r, GRASS.g, GRASS.b);
    for (let r = 1; r < RINGS.length; r++) {
      const t = RINGS[r];
      for (let s = 0; s < SEGMENTS; s++) {
        const th = (s / SEGMENTS) * Math.PI * 2;
        const rr = this.edge(th) * t;
        const lx = Math.cos(th) * rr;
        const lz = Math.sin(th) * rr;
        pos.push(lx, this.profile(t, lx, lz), lz);
        if (t < GRASS_T) c.copy(GRASS).lerp(GRASS_DARK, (Math.sin(th * 7 + t * 9) + 1) * 0.3);
        else if (t < GRASS_T + 0.08) c.copy(GRASS).lerp(SAND, 0.6);
        else if (t <= 1.0) c.copy(SAND);
        else c.copy(SAND_WET);
        col.push(c.r, c.g, c.b);
      }
    }
    // tam giác vòng trong cùng
    for (let s = 0; s < SEGMENTS; s++) {
      const a = 1 + s;
      const b = 1 + ((s + 1) % SEGMENTS);
      idx.push(0, b, a);
    }
    // các dải giữa các vòng
    for (let r = 1; r < RINGS.length - 1; r++) {
      const base0 = 1 + (r - 1) * SEGMENTS;
      const base1 = 1 + r * SEGMENTS;
      for (let s = 0; s < SEGMENTS; s++) {
        const s1 = (s + 1) % SEGMENTS;
        const a = base0 + s;
        const b = base0 + s1;
        const cc = base1 + s;
        const d = base1 + s1;
        idx.push(a, b, d, a, d, cc);
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo = geo.toNonIndexed(); // đổ bóng phẳng kiểu low-poly
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    );
    mesh.receiveShadow = true;
    mesh.userData.terrain = true;
    return mesh;
  }

  /** Lấy một điểm ngẫu nhiên trong khoảng t ∈ [tMin, tMax]. */
  randomPoint(rand, tMin, tMax) {
    const th = rand() * Math.PI * 2;
    const t = tMin + Math.sqrt(rand()) * (tMax - tMin);
    const r = this.edge(th) * t;
    const lx = Math.cos(th) * r;
    const lz = Math.sin(th) * r;
    return { lx, lz, t, y: this.profile(t, lx, lz) };
  }
}

export class Islands {
  /**
   * @param models  { name: Object3D } các mô hình đạo cụ đã nạp
   */
  constructor(
    scene,
    models,
    {
      seed = DEFAULT_MAP_SEED,
      count = 15,
      fortRatio = FORT.fortRatio,
      worldRadius = WORLD.radius,
      safeRadius = 30,
      fortMinDist = FORT.minDistFromSpawn,
      gap = 24,
    } = {},
  ) {
    this.list = [];
    this.seed = seed;
    this.scene = scene;
    this.objects = []; // mọi thứ đã thêm vào scene (để dọn khi đổi bản đồ)
    this.forts = [];
    this.worldRadius = worldRadius;
    const rand = mulberry32(seed);

    // Hai đảo không được sát nhau: khoảng cách mép tối thiểu ≈ gap
    const fits = (x, z, r) =>
      this.list.every((o) => Math.hypot(o.x - x, o.z - z) > (o.radius + r) * 1.12 + gap) &&
      RESERVED.every((z0) => Math.hypot(z0.x - x, z0.z - z) > z0.r + r * 1.12);
    // Pháo đài không được phủ tầm bắn lên cứ điểm / tháp tiếp đạn
    const fortAllowed = (x, z, r) => RESERVED.every((z0) => Math.hypot(z0.x - x, z0.z - z) > z0.r * 0.5 + r * 0.6 + FORT.castleRange);
    const scatter = (n, minD, makeRadius) => {
      let placed = 0;
      for (let tries = 0; placed < n && tries < 1200; tries++) {
        const radius = makeRadius();
        const a = rand() * Math.PI * 2;
        const d = minD + radius + rand() * Math.max(0, worldRadius - minD - radius);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (!fits(x, z, radius)) continue;
        // Hầu hết đảo có pháo đài, trừ những đảo quá gần điểm xuất phát
        const fort = d - radius > fortMinDist - 40 && fortAllowed(x, z, radius) && rand() < fortRatio;
        this.list.push(new Island(x, z, radius, fort ? 3 : 2.2 + rand() * 2.5, rand, fort));
        placed++;
      }
    };

    // 1) Một đảo nhỏ ngay phía trước điểm xuất phát (phía trên màn hình = -Z) để thấy ngay khi vào game
    {
      const r = 18 + rand() * 6;
      const a = -Math.PI / 2 + (rand() - 0.5) * 0.9;
      const d = safeRadius + r * 1.15;
      this.list.push(new Island(Math.cos(a) * d, Math.sin(a) * d, r, 2.6, rand));
    }
    // 2) Các đảo còn lại (phần lớn có pháo đài)
    scatter(count - 1, safeRadius + 20, () => 16 + rand() * 22);

    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    // Đạo cụ (cây, cỏ, đá...) được gom theo mẫu rồi vẽ bằng InstancedMesh:
    // hàng nghìn vật thể chỉ tốn vài chục draw call -> nhẹ cho GPU tích hợp.
    const instances = new Map(); // src -> { matrices: Matrix4[], shadow }
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (group, src, p, scale, rotY = rand() * Math.PI * 2, shadow = false) => {
      if (!src) return;
      let entry = instances.get(src);
      if (!entry) instances.set(src, (entry = { matrices: [], shadow: false }));
      const pos = new THREE.Vector3(group.position.x + p.lx, p.y - 0.1, group.position.z + p.lz);
      entry.matrices.push(new THREE.Matrix4().compose(pos, q.setFromAxisAngle(up, rotY), new THREE.Vector3(scale, scale, scale)));
      entry.shadow ||= shadow;
    };

    const palms = ['palm-detailed-bend', 'palm-detailed-straight', 'palm-bend', 'palm-straight'].map((n) => models[n]);
    const grass = ['grass-plant', 'grass-patch', 'grass'].map((n) => models[n]);
    const foliage = ['patch-grass-foliage'].map((n) => models[n]);
    const beachFoliage = ['patch-sand-foliage'].map((n) => models[n]);
    const rocks = ['rocks-sand-a', 'rocks-sand-b', 'rocks-sand-c', 'rocks-a', 'rocks-b', 'rocks-c'].map((n) => models[n]);
    const loot = ['chest', 'barrel', 'crate'].map((n) => models[n]);

    for (const isl of this.list) {
      const g = new THREE.Group();
      g.position.set(isl.x, 0, isl.z);
      g.add(isl.buildMesh());

      const area = isl.radius / 25; // hệ số theo kích thước đảo
      // Cây cọ (cụm lại vài chỗ cho tự nhiên)
      // đảo pháo đài: chừa khoảng giữa cho thành / tháp canh
      const inner = isl.fort ? (isl.radius >= FORT.castleMinRadius ? 0.5 : 0.3) : 0;
      const clusters = (isl.fort ? 1 : 2) + Math.floor(rand() * 2 + area * 2);
      for (let c = 0; c < clusters; c++) {
        const center = isl.randomPoint(rand, inner + 0.05, isl.fort ? 0.75 : 0.6);
        const n = 3 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const lx = center.lx + (rand() - 0.5) * 9;
          const lz = center.lz + (rand() - 0.5) * 9;
          const h = isl.heightAt(isl.x + lx, isl.z + lz);
          const t = isl.tAt(isl.x + lx, isl.z + lz);
          if (t > 0.8 || t < inner) continue;
          place(g, pick(palms), { lx, lz, y: h }, 1.6 + rand() * 0.7, undefined, true);
        }
      }
      // Thảm cỏ lớn
      for (let i = 0; i < Math.round(5 * area + 2); i++) place(g, pick(foliage), isl.randomPoint(rand, inner, 0.65), 1.6 + rand());
      // Bụi cỏ nhỏ rải rác
      for (let i = 0; i < Math.round(55 * area); i++) place(g, pick(grass), isl.randomPoint(rand, inner * 0.9, GRASS_T), 2 + rand() * 1.5);
      // Cây bụi trên bãi cát
      for (let i = 0; i < Math.round(2 * area); i++) place(g, pick(beachFoliage), isl.randomPoint(rand, 0.75, 0.95), 1.3 + rand() * 0.6);
      // Đá ven bờ
      for (let i = 0; i < Math.round(3 * area + 1); i++) {
        const p = isl.randomPoint(rand, 0.85, 1.12);
        p.y = Math.max(p.y, -1.2);
        place(g, pick(rocks), p, 1.2 + rand() * 1.4);
      }
      // Thỉnh thoảng có rương/thùng trên bãi
      if (rand() < 0.6) place(g, pick(loot), isl.randomPoint(rand, 0.7, 0.88), 1.6);

      scene.add(g);
      this.objects.push(g);
      isl.group = g;
      if (isl.fort) this.forts.push(new Fort(isl, models, rand));
    }

    const tmp = new THREE.Matrix4();
    for (const [src, { matrices, shadow }] of instances) {
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
        matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, o.matrixWorld)));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        scene.add(im);
        this.objects.push(im);
      });
    }
  }

  /** Gỡ toàn bộ đảo khỏi scene (khi vào phòng online có mapSeed khác). */
  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o);
      if (o.isInstancedMesh) o.dispose();
      else
        o.traverse((m) => {
          // Chỉ huỷ hình học tự sinh của địa hình; model dùng chung thì giữ lại
          if (m.isMesh && m.userData.terrain) {
            m.geometry.dispose();
            m.material.dispose();
          }
        });
    }
    this.objects = [];
    this.list = [];
    this.forts = [];
  }

  update(dt, ships, projectiles, effects) {
    for (const f of this.forts) f.update(dt, ships, projectiles, effects);
  }

  /** Dữ liệu thuần cho AI: vật cản (đảo) và vùng nguy hiểm (pháo đài). */
  obstacleData() {
    return {
      islands: this.list.map((i) => ({ x: i.x, z: i.z, r: i.radius * 1.12 })),
      forts: this.forts.map((f) => ({ x: f.x, z: f.z, r: f.dangerRadius })),
    };
  }

  /** Một điểm trên biển không nằm trong đảo / vùng pháo đài. */
  isOpenWater(x, z, pad = 10, avoidForts = true) {
    if (this.list.some((i) => Math.hypot(i.x - x, i.z - z) < i.radius * 1.2 + pad)) return false;
    if (avoidForts && this.forts.some((f) => Math.hypot(f.x - x, f.z - z) < f.dangerRadius + pad)) return false;
    return true;
  }

  /** Độ cao mặt đất cao nhất tại điểm (để kiểm tra đạn chạm đảo). */
  groundAt(x, z) {
    let h = -Infinity;
    for (const isl of this.list) {
      if (Math.abs(x - isl.x) > isl.radius * 1.6 || Math.abs(z - isl.z) > isl.radius * 1.6) continue;
      h = Math.max(h, isl.heightAt(x, z));
    }
    return h;
  }

  /** Đẩy tàu ra khỏi đảo và giảm tốc khi mắc cạn. */
  collideShip(ship, shipRadius = ship.radius * 0.85) {
    const p = ship.position;
    for (const isl of this.list) {
      const dx = p.x - isl.x;
      const dz = p.z - isl.z;
      const dist = Math.hypot(dx, dz);
      const limit = isl.edge(Math.atan2(dz, dx)) * 1.02 + shipRadius;
      if (dist < limit && dist > 0.001) {
        const push = limit - dist;
        p.x += (dx / dist) * push;
        p.z += (dz / dist) * push;
        ship.speed *= 0.85;
        return true;
      }
    }
    return false;
  }
}

export const ISLAND_PROP_MODELS = [
  ...FORT_MODELS,
  'palm-detailed-bend',
  'palm-detailed-straight',
  'palm-bend',
  'palm-straight',
  'grass-plant',
  'grass-patch',
  'grass',
  'patch-grass-foliage',
  'patch-sand-foliage',
  'rocks-sand-a',
  'rocks-sand-b',
  'rocks-sand-c',
  'rocks-a',
  'rocks-b',
  'rocks-c',
  'chest',
  'barrel',
  'crate',
];

export { GRASS_T };
