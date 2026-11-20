import * as THREE from 'three';
import { COMBAT } from '../config/game.js';

const TRAIL_SPACING = 0.6; // khoảng cách giữa các hạt vệt khói (đơn vị thế giới)
const GLOW = { player: 0xffc060, bot: 0xff8a3a, fort: 0xff4a3a };
const BOT_AIM_ERROR = 0.09; // rad (~5°)

/**
 * Quản lý mọi viên đạn đại bác: bắn loạt mạn từ tàu (người chơi/bot) và đạn pháo đài.
 * Va chạm: tàu (trừ tàu bắn ra), đảo/tường thành, mặt nước.
 */
export class Projectiles {
  constructor({ scene, effects, ocean, islands, sound, ballTemplate }) {
    this.scene = scene;
    this.effects = effects;
    this.ocean = ocean;
    this.islands = islands;
    this.sound = sound;
    this.ballTemplate = ballTemplate;
    this.balls = [];
    this.pending = []; // phát bắn trễ ngẫu nhiên cho loạt bắn tự nhiên
    /** (target: Ship, damage, attacker: Ship|null, point: Vector3) => void */
    this.onHit = null;
    /** (ship: Ship) => void — mỗi khi một tàu bắn một loạt */
    this.onBroadside = null;
    /** (ship: Ship) => void — bấm bắn khi đã hết đạn */
    this.onOutOfAmmo = null;
    /** ({pos, vel, kind, owner}) => void — mỗi viên đạn bắn ra từ máy này (để gửi lên server) */
    this.onLaunch = null;
    /** (ship) => boolean — máy này có được bắn thay tàu này không (online: tàu mình / bot khi là chủ phòng) */
    this.canFire = null;
  }

  makeBall() {
    if (this.ballTemplate) return this.ballTemplate.clone();
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 }),
    );
  }

  /** Bắn loạt mạn. side: 'left' | 'right' | 'both'. Tôn trọng thời gian nạp đạn của từng mạn. */
  fireBroadside(ship, side) {
    if (ship.sunk) return false;
    if (this.canFire && !this.canFire(ship)) return false;
    const sides = side === 'both' ? ['left', 'right'] : [side];
    let fired = false;
    for (const s of sides) {
      if (ship.reload[s] > 0) continue;
      if (ship.ammo <= 0) {
        this.onOutOfAmmo?.(ship);
        break;
      }
      ship.ammo--; // mỗi loạt một mạn = 1 lần bắn
      ship.reload[s] = ship.reloadTime; // đã tính nâng cấp thủy thủ + buff nạp đạn thần tốc
      fired = true;
      const volley = ++ship.volleySeq;
      const fire = ship.buffs.fire > 0;
      ship.guns.forEach((gun, i) => {
        this.pending.push({ ship, side: s, gun, volley, fire, delay: i * 0.08 + Math.random() * 0.1 });
      });
    }
    if (fired && this.onBroadside) this.onBroadside(ship);
    return fired;
  }

  spawnShipBall(ship, side, gun, volley = 0, fire = false) {
    ship.root.updateMatrixWorld();
    const sign = side === 'left' ? 1 : -1;
    const pos = ship.root.localToWorld(new THREE.Vector3(gun.x * sign, gun.y, gun.z));
    const q = ship.root.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(sign, 0, 0).applyQuaternion(q);
    dir.y = Math.max(dir.y, 0) + 0.12; // nâng nòng nhẹ
    if (!ship.isPlayer) {
      // Bot ngắm kém hơn người một chút: lệch ngẫu nhiên vài độ
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * BOT_AIM_ERROR);
      dir.y += (Math.random() - 0.5) * 0.06;
    }
    dir.normalize();
    const vel = dir
      .clone()
      .multiplyScalar(COMBAT.muzzleSpeed * (0.95 + Math.random() * 0.1))
      .add(ship.velocity);
    this.launch(pos, vel, { owner: ship, damage: ship.damageValue, kind: ship.isPlayer ? 'player' : 'bot', side, volley, fire });
    this.effects.muzzle(pos, dir, ship.velocity);
  }

  /** Tạo một viên đạn bay từ pos với vận tốc vel. */
  /**
   * remote = true: đạn nhận từ mạng, chỉ để hiển thị (không báo trúng, không gửi lại).
   */
  launch(pos, vel, { owner = null, damage = COMBAT.fortDamage, kind = 'fort', remote = false, side = null, volley = 0, fire = false } = {}) {
    const mesh = this.makeBall();
    mesh.position.copy(pos);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.effects.soft,
        color: fire ? 0xff5a14 : GLOW[kind],
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.renderOrder = 10;
    glow.scale.setScalar(3.2);
    mesh.add(glow);
    this.scene.add(mesh);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: this.effects.soft, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(shadow);

    this.balls.push({ mesh, glow, shadow, vel: vel.clone(), owner, damage, kind, remote, fire, age: 0, lastTrail: pos.clone() });
    this.sound?.cannon(pos);
    if (!remote && this.onLaunch) this.onLaunch({ pos, vel, kind, owner, side, volley, fire });
  }

  removeBall(i) {
    const b = this.balls[i];
    this.scene.remove(b.mesh, b.shadow);
    b.glow.material.dispose();
    b.shadow.geometry.dispose();
    b.shadow.material.dispose();
    this.balls.splice(i, 1);
  }

  clear() {
    for (let i = this.balls.length - 1; i >= 0; i--) this.removeBall(i);
    this.pending.length = 0;
  }

  update(dt, ships) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        if (!p.ship.sunk) this.spawnShipBall(p.ship, p.side, p.gun, p.volley, p.fire);
        this.pending.splice(i, 1);
      }
    }

    for (const s of ships) s.root.updateMatrixWorld();

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.age += dt;
      b.vel.y -= COMBAT.gravity * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += dt * 8;
      const p = b.mesh.position;
      const water = this.ocean.getHeight(p.x, p.z);

      // Vệt khói rải đều theo quãng đường bay
      const seg = p.clone().sub(b.lastTrail);
      const segLen = seg.length();
      if (segLen >= TRAIL_SPACING) {
        const steps = Math.floor(segLen / TRAIL_SPACING);
        seg.divideScalar(segLen);
        for (let s = 1; s <= steps; s++) this.effects.trail(b.lastTrail.clone().addScaledVector(seg, s * TRAIL_SPACING), b.fire);
        b.lastTrail.addScaledVector(seg, steps * TRAIL_SPACING);
      }

      b.glow.material.opacity = 0.75 + Math.random() * 0.25;
      const height = Math.max(0, p.y - water);
      b.shadow.position.set(p.x, water + 0.06, p.z);
      b.shadow.scale.setScalar(1 + height * 0.06);
      b.shadow.material.opacity = THREE.MathUtils.clamp(0.5 - height * 0.03, 0.15, 0.5);

      // Trúng tàu
      let hitShip = null;
      for (const s of ships) {
        if (s === b.owner || s.sunk) continue;
        if (b.owner?.team && s.team === b.owner.team) continue; // không bắn trúng đồng đội
        const dx = s.position.x - p.x;
        const dz = s.position.z - p.z;
        if (dx * dx + dz * dz > (s.radius + 2) * (s.radius + 2)) continue;
        if (s.containsPoint(p)) {
          hitShip = s;
          break;
        }
      }
      if (hitShip) {
        this.effects.explosion(p);
        this.sound?.hit(p);
        if (b.fire) this.effects.burning(p, 1.5);
        if (!b.remote && this.onHit) this.onHit(hitShip, b.damage, b.owner, p.clone(), b);
        this.removeBall(i);
        continue;
      }

      // Chạm đảo -> bụi cát; rơi xuống nước -> bọt nước
      const ground = this.islands ? this.islands.groundAt(p.x, p.z) : -Infinity;
      const hitGround = ground > water && p.y <= ground;
      if (hitGround || p.y <= water || b.age > 10) {
        if (hitGround) {
          this.effects.impact(p);
          this.sound?.thud(p);
        } else if (b.age <= 10) {
          this.effects.splash(p);
          this.sound?.splash(p);
        }
        this.removeBall(i);
      }
    }
  }
}
