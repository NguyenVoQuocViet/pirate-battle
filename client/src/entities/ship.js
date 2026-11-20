import * as THREE from 'three';
import { AMMO, CTF, NET, SKILL, BUFFS, upgradeStats, emptyUpgrades } from '../config/game.js';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

const MODEL_HALF_BEAM = 2.4; // bề ngang nửa thân tàu của bộ model (đơn vị model)
const DRAFT = 1.1; // mớn nước
const GUN_Y = 1.9; // độ cao lỗ pháo (toạ độ model)

let nextId = 1;

/**
 * Một con tàu (người chơi hoặc bot). Điều khiển bằng "input" giống bàn phím:
 * { forward, backward, left, right }. Thông số lấy từ config/ships.js.
 *
 * Mô hình có mũi tàu hướng +Z: rotation.y = heading cho vector tiến (sin h, 0, cos h).
 */
export class Ship {
  constructor({ type, template, ocean, name, team = null, isPlayer = false }) {
    this.id = isPlayer ? 'player' : `bot-${nextId++}`;
    this.team = team;
    this.type = type;
    this.name = name;
    this.isPlayer = isPlayer;
    this.ocean = ocean;

    this.root = new THREE.Group();
    this.model = template.clone();
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const s = type.scale;
    this.model.scale.setScalar(s);
    this.model.position.y = -DRAFT * s;
    this.root.add(this.model);

    // Kích thước suy ra từ model (để hỗ trợ cả model mới không có trong preset)
    const box = new THREE.Box3().setFromObject(template);
    this.length = (box.max.z - box.min.z) * s;
    this.beam = MODEL_HALF_BEAM * 2 * s;
    this.height = (box.max.y - box.min.y) * s;
    this.radius = this.length * 0.42;
    this.hull = {
      x: (MODEL_HALF_BEAM + 0.2) * s,
      zMin: (box.min.z - 0.2) * s,
      zMax: (box.max.z + 0.2) * s,
      yMin: -1.6,
      yMax: this.height * 0.7,
    };
    // Vị trí các khẩu pháo dọc thân (toạ độ cục bộ của root)
    const L = box.max.z - box.min.z;
    const cz = (box.max.z + box.min.z) / 2;
    this.guns = [];
    for (let i = 0; i < type.guns; i++) {
      const f = type.guns === 1 ? 0 : i / (type.guns - 1);
      const z = (cz + L * (-0.24 + 0.4 * f)) * s;
      this.guns.push(new THREE.Vector3((MODEL_HALF_BEAM + 0.15) * s, (GUN_Y - DRAFT) * s, z));
    }

    // Thông số lái
    this.maxSpeed = type.maxSpeed;
    this.maxReverse = -type.maxSpeed * 0.25;
    this.accel = type.accel;
    this.brake = type.accel * 1.5;
    this.drag = 0.18;
    this.maxTurnRate = type.turnRate;
    this.rudderSpeed = 1.6;

    this.heading = Math.PI;
    this.speed = 0;
    this.rudder = 0;
    this.turnRate = 0;
    this.velocity = new THREE.Vector3();
    this.pitch = 0;
    this.roll = 0;
    this.bobY = 0;

    this.maxHp = type.maxHp;
    this.hp = this.maxHp;
    this.reload = { left: 0, right: 0 };
    this.sunk = false;
    this.sinkTime = 0;
    this.removed = false; // đã chìm hẳn, có thể gỡ khỏi scene
    this.lastAttacker = null;

    // Đạn: mỗi loạt một mạn tốn 1 lần bắn; hết phải về tháp tiếp đạn
    this.maxAmmo = type.ammo ?? AMMO.max;
    this.ammo = this.maxAmmo;
    this.resupply = 0; // tiến độ nạp đạn ở tháp (giây), 0 = không nạp
    this.groundCooldown = 0; // chống trừ máu liên tục khi cọ vào bờ
    this.carryingFlag = null; // Flag đang mang (chế độ Cướp cờ)
    this.deaths = 0;
    this.kills = 0;
    this.respawnTimer = 0;

    // Nâng cấp (giữ nguyên khi bị chìm), buff tạm thời, kỹ năng lướt sóng, gió, cháy
    this.upgrades = emptyUpgrades();
    this.buffs = { fire: 0, rapid: 0 }; // giây hiệu lực còn lại
    this.boostTime = 0; // còn bao lâu đang lướt sóng
    this.boostCooldown = 0;
    this.windFactor = 1;
    this.burn = null; // { time, tick, by } — đang cháy (chế độ chơi đơn tự tính sát thương)
    this.burnVisual = 0; // giây còn hiển thị lửa (online: server tính sát thương)
    this.volleySeq = 0; // mã loạt bắn (server dùng để chống bắn liên thanh)
    this.applyUpgrades();

    // Nhiều người chơi: tàu "remote" không tự chạy vật lý mà nội suy theo trạng thái từ server
    this.netId = null;
    this.remote = false;
    this.net = null; // { x, z, h, s, at }
  }

  /** Tính lại chỉ số theo cấp nâng cấp. Không tự đổi máu hiện tại (người gọi quyết định hồi máu). */
  applyUpgrades() {
    const st = upgradeStats(this.type, this.upgrades);
    this.maxHp = st.maxHp;
    this.baseDamage = st.damage;
    this.baseReload = st.reload;
    this.resupplyTime = st.resupplyTime;
    this.maxSpeed = st.maxSpeed;
    this.maxReverse = -st.maxSpeed * 0.25;
    this.maxTurnRate = st.turnRate;
  }

  /** Sát thương mỗi viên (đã tính thuốc súng). */
  get damageValue() {
    return this.baseDamage;
  }

  /** Thời gian nạp mỗi mạn (đã tính thủy thủ + buff nạp đạn thần tốc). */
  get reloadTime() {
    return this.baseReload * (this.buffs.rapid > 0 ? BUFFS.kinds.rapid.reloadMul : 1);
  }

  get boostReady() {
    return this.boostCooldown <= 0 && !this.sunk;
  }

  /** Kích hoạt "Căng buồm lướt sóng". Trả về true nếu dùng được. */
  activateBoost() {
    if (!this.boostReady) return false;
    this.boostTime = SKILL.duration;
    this.boostCooldown = SKILL.cooldown;
    if (this.speed < this.maxSpeed * 0.6) this.speed = Math.max(this.speed, this.maxSpeed * 0.6); // đẩy trớn ngay
    return true;
  }

  applyBuff(id) {
    this.buffs[id] = BUFFS.duration;
  }

  /** Nhận trạng thái mạng (x, z, heading, speed). Lệch quá xa thì dịch chuyển tức thì. */
  setNetState(x, z, h, s) {
    const first = !this.net;
    this.net = { x, z, h, s, at: performance.now() };
    if (first || Math.hypot(x - this.root.position.x, z - this.root.position.z) > NET.snapDistance) {
      this.root.position.x = x;
      this.root.position.z = z;
      this.heading = h;
    }
  }

  /** Nội suy mượt tới vị trí mạng, ngoại suy nhẹ theo vận tốc để bù độ trễ. */
  updateRemote(dt) {
    const n = this.net;
    if (!n) return;
    const age = Math.min(0.25, (performance.now() - n.at) / 1000);
    const tx = n.x + Math.sin(n.h) * n.s * age;
    const tz = n.z + Math.cos(n.h) * n.s * age;
    const k = 1 - Math.exp(-10 * dt);
    const p = this.root.position;
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    const prevHeading = this.heading;
    this.heading += wrapAngle(n.h - this.heading) * k;
    this.turnRate = dt > 0 ? wrapAngle(this.heading - prevHeading) / dt : 0;
    this.speed = n.s;
    this.forward(this.velocity).multiplyScalar(this.speed);
  }

  /** Hồi sinh tại vị trí mới với đầy máu, đầy đạn. */
  respawn(x, z, heading) {
    this.hp = this.maxHp;
    this.ammo = this.maxAmmo;
    this.reload.left = this.reload.right = 0;
    this.resupply = 0;
    this.sunk = false;
    this.sinkTime = 0;
    this.removed = false;
    this.lastAttacker = null;
    this.pitch = this.roll = 0;
    this.velocity.set(0, 0, 0);
    this.buffs.fire = this.buffs.rapid = 0;
    this.boostTime = 0;
    this.boostCooldown = 0;
    this.burn = null;
    this.burnVisual = 0;
    this.setPose(x, z, heading);
  }

  get position() {
    return this.root.position;
  }

  get alive() {
    return !this.sunk;
  }

  setPose(x, z, heading) {
    this.root.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.rudder = 0;
    this.turnRate = 0;
    this.bobY = 0;
    this.root.rotation.set(0, heading, 0, 'YXZ');
  }

  /** Trừ máu. Trả về true nếu phát này làm tàu chìm. */
  damage(amount, attacker = null) {
    if (this.sunk) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (attacker) this.lastAttacker = attacker;
    if (this.hp === 0) {
      this.sunk = true;
      this.sinkTime = 0;
      return true;
    }
    return false;
  }

  heal(amount) {
    if (this.sunk) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  forward(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /**
   * Điểm thế giới nằm ở mạn nào của tàu. Mạn trái (port) cục bộ là +X,
   * tức vector (cos h, 0, -sin h) = (f.z, 0, -f.x) trong toạ độ thế giới.
   */
  sideOf(point) {
    const f = this.forward(new THREE.Vector3());
    const dx = point.x - this.root.position.x;
    const dz = point.z - this.root.position.z;
    return dx * f.z - dz * f.x >= 0 ? 'left' : 'right';
  }

  /** Điểm thế giới có nằm trong hộp thân tàu không. */
  containsPoint(p) {
    const local = this.root.worldToLocal(p.clone());
    const h = this.hull;
    return Math.abs(local.x) < h.x && local.z > h.zMin && local.z < h.zMax && local.y > h.yMin && local.y < h.yMax;
  }

  update(dt, input, time) {
    this.reload.left = Math.max(0, this.reload.left - dt);
    this.reload.right = Math.max(0, this.reload.right - dt);
    this.groundCooldown = Math.max(0, this.groundCooldown - dt);
    this.buffs.fire = Math.max(0, this.buffs.fire - dt);
    this.buffs.rapid = Math.max(0, this.buffs.rapid - dt);
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    this.burnVisual = Math.max(0, this.burnVisual - dt);

    if (this.remote && !this.sunk) {
      this.updateRemote(dt);
      this.applyWaves(dt, time);
      return;
    }

    if (this.sunk) {
      // Chìm dần, nghiêng sang một bên
      this.sinkTime += dt;
      this.speed *= Math.exp(-1.5 * dt);
      this.forward(this.velocity).multiplyScalar(this.speed);
      this.root.position.addScaledVector(this.velocity, dt);
      this.root.position.y = this.bobY - Math.max(0, this.sinkTime - 0.6) * 1.5;
      this.roll = damp(this.roll, 0.7, 0.7, dt);
      this.pitch = damp(this.pitch, -0.3, 0.5, dt);
      this.root.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
      if (this.sinkTime > 8) this.removed = true;
      return;
    }

    // --- Ga / phanh có quán tính ---
    const boosting = this.boostTime > 0;
    if (input.forward || boosting) this.speed += this.accel * (boosting ? 1.8 : 1) * dt;
    if (input.backward) this.speed -= (this.speed > 0 ? this.brake : this.accel * 0.6) * dt;
    const dragK = input.forward || input.backward ? this.drag * 0.4 : this.drag;
    this.speed -= this.speed * dragK * dt;
    if (!input.forward && !input.backward && Math.abs(this.speed) < 0.05) this.speed = 0;
    // Tốc độ tối đa = gốc (đã tính cánh buồm) × gió × kỹ năng lướt sóng × mang cờ
    const top =
      this.maxSpeed *
      this.windFactor *
      (boosting ? 1 + SKILL.speedBonus : 1) *
      (this.carryingFlag ? CTF.carrierSpeedFactor : 1);
    if (this.speed < this.maxReverse) this.speed = this.maxReverse;
    if (this.speed > top) this.speed -= (this.speed - top) * Math.min(1, dt * 2.5);

    // --- Bánh lái: xoay dần, tự trả về giữa khi buông ---
    const rudderTarget = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    if (rudderTarget !== 0) {
      this.rudder = THREE.MathUtils.clamp(this.rudder + rudderTarget * this.rudderSpeed * dt, -1, 1);
    } else {
      this.rudder = damp(this.rudder, 0, 2.5, dt);
    }

    // Tàu chỉ quay hiệu quả khi có trớn; vẫn quay chậm khi gần đứng yên
    const speedFactor = 0.2 + 0.8 * Math.min(1, Math.abs(this.speed) / (this.maxSpeed * 0.45));
    const dir = this.speed < 0 ? -1 : 1;
    const targetTurn = this.rudder * this.maxTurnRate * speedFactor * dir;
    this.turnRate = damp(this.turnRate, targetTurn, 2.2, dt);
    this.heading += this.turnRate * dt;

    // --- Di chuyển ---
    this.forward(this.velocity).multiplyScalar(this.speed);
    this.root.position.addScaledVector(this.velocity, dt);

    this.applyWaves(dt, time);
  }

  /** Dập dềnh theo sóng: nhấp nhô, chúi mũi, nghiêng mạn. */
  applyWaves(dt, time) {
    const p = this.root.position;
    const f = this.forward(new THREE.Vector3());
    const side = new THREE.Vector3(f.z, 0, -f.x);
    const hL = this.length * 0.45;
    const hB = this.beam * 0.5;
    const hBow = this.ocean.getHeight(p.x + f.x * hL, p.z + f.z * hL, time);
    const hStern = this.ocean.getHeight(p.x - f.x * hL, p.z - f.z * hL, time);
    const hPort = this.ocean.getHeight(p.x + side.x * hB, p.z + side.z * hB, time);
    const hStar = this.ocean.getHeight(p.x - side.x * hB, p.z - side.z * hB, time);
    const hMid = this.ocean.getHeight(p.x, p.z, time);

    const targetY = (hBow + hStern + hPort + hStar + hMid * 2) / 6;
    const targetPitch = -Math.atan2(hBow - hStern, hL * 2) - this.speed * 0.004;
    const heel = this.turnRate * (this.speed / this.maxSpeed) * 0.35;
    const targetRoll = Math.atan2(hPort - hStar, hB * 2) * 0.8 + heel;

    this.bobY = damp(this.bobY, targetY, 4, dt);
    this.pitch = damp(this.pitch, targetPitch, 3, dt);
    this.roll = damp(this.roll, targetRoll, 2.5, dt);

    p.y = this.bobY;
    this.root.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }

  /** Ảnh chụp trạng thái dạng dữ liệu thuần (cho AI và sau này gửi lên server). */
  snapshot() {
    const p = this.root.position;
    return {
      id: this.id,
      x: p.x,
      z: p.z,
      vx: this.velocity.x,
      vz: this.velocity.z,
      heading: this.heading,
      speed: this.speed,
      maxSpeed: this.maxSpeed,
      radius: this.radius,
      reloadLeft: this.reload.left,
      reloadRight: this.reload.right,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      boostReady: this.boostReady,
      team: this.team,
      carrying: !!this.carryingFlag,
      hp: this.hp,
      maxHp: this.maxHp,
    };
  }

  dispose(scene) {
    scene.remove(this.root);
  }
}
