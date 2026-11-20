import * as THREE from 'three';

function makeSoftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Hệ hạt đơn giản dựa trên Sprite: khói, chớp lửa nòng, bọt nước. */
export class Effects {
  constructor(scene, ocean) {
    this.scene = scene;
    this.ocean = ocean;
    this.soft = makeSoftTexture();
    this.ringTex = makeRingTexture();
    this.particles = [];
    this.rings = [];
    this.flashLight = new THREE.PointLight(0xffa040, 0, 30, 2);
    scene.add(this.flashLight);
    this.flashTime = 0;
  }

  spawn({ pos, vel, color, size, grow, life, opacity, gravity = 0, drag = 0, additive = false, floatOnWater = false }) {
    const mat = new THREE.SpriteMaterial({
      map: this.soft,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.particles.push({ s, vel: vel.clone(), size, grow, life, age: 0, opacity, gravity, drag, floatOnWater });
  }

  muzzle(pos, dir, shipVel) {
    // Chớp lửa
    for (let i = 0; i < 3; i++) {
      this.spawn({
        pos: pos.clone().addScaledVector(dir, 0.4 + i * 0.5),
        vel: dir.clone().multiplyScalar(6).add(shipVel),
        color: i === 0 ? 0xffffcc : 0xff9a3c,
        size: 1.6 - i * 0.3,
        grow: 2,
        life: 0.12 + i * 0.03,
        opacity: 1,
        additive: true,
      });
    }
    // Khói
    for (let i = 0; i < 9; i++) {
      const v = dir.clone().multiplyScalar(4 + Math.random() * 6);
      v.x += (Math.random() - 0.5) * 2;
      v.y += 0.5 + Math.random() * 1.5;
      v.z += (Math.random() - 0.5) * 2;
      v.addScaledVector(shipVel, 0.6);
      this.spawn({
        pos: pos.clone().addScaledVector(dir, 0.5 + Math.random()),
        vel: v,
        color: new THREE.Color().setScalar(0.75 + Math.random() * 0.2),
        size: 1.2 + Math.random(),
        grow: 2.5 + Math.random() * 1.5,
        life: 2 + Math.random() * 1.5,
        opacity: 0.7,
        drag: 1.6,
      });
    }
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 60;
    this.flashTime = 0.1;
  }

  /** Vệt bay sau đạn: lõi lửa ngắn + khói xám kéo dài. */
  trail(pos, fire = false) {
    if (fire) {
      // Đạn lửa: lõi lửa to, đỏ cam, kéo dài hơn
      this.spawn({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.8, (Math.random() - 0.5) * 0.6),
        color: Math.random() < 0.5 ? 0xff5a14 : 0xffa030,
        size: 1.6,
        grow: -0.5,
        life: 0.45,
        opacity: 0.95,
        additive: true,
      });
    }
    this.spawn({
      pos,
      vel: new THREE.Vector3(),
      color: fire ? 0xff7a26 : 0xffb347,
      size: 1.3,
      grow: -0.7,
      life: 0.22,
      opacity: 0.9,
      additive: true,
    });
    this.spawn({
      pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4),
      color: 0xf0f0f0,
      size: 1.0,
      grow: 1.6,
      life: 0.8,
      opacity: 0.6,
      drag: 1,
    });
  }

  /** Đạn trúng tàu: chớp lửa, mảnh gỗ văng, khói đen. */
  explosion(pos) {
    for (let i = 0; i < 4; i++) {
      this.spawn({
        pos,
        vel: new THREE.Vector3(0, 1, 0),
        color: i < 2 ? 0xffe08a : 0xff6a20,
        size: 2.2 + i * 0.6,
        grow: 1.5,
        life: 0.25 + i * 0.05,
        opacity: 1,
        additive: true,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * r, 4 + Math.random() * 6, Math.sin(a) * r),
        color: i % 2 ? 0x7a4a24 : 0xa86b3a,
        size: 0.35 + Math.random() * 0.35,
        grow: 0,
        life: 0.9 + Math.random() * 0.4,
        opacity: 1,
        gravity: 18,
      });
    }
    for (let i = 0; i < 7; i++) {
      this.spawn({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2),
        color: new THREE.Color().setScalar(0.18 + Math.random() * 0.15),
        size: 1.5 + Math.random(),
        grow: 2.5,
        life: 1.8 + Math.random(),
        opacity: 0.75,
        drag: 0.8,
      });
    }
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 80;
    this.flashTime = 0.15;
  }

  /** Tàu phát nổ khi về 0 HP: vài vụ nổ lệch nhau + cột khói đen. */
  shipExplosion(pos) {
    for (let i = 0; i < 4; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 7));
      setTimeout(() => this.explosion(p), i * 140);
    }
    for (let i = 0; i < 12; i++) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 6)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3),
        color: new THREE.Color().setScalar(0.12 + Math.random() * 0.1),
        size: 3 + Math.random() * 2,
        grow: 2.5,
        life: 3 + Math.random() * 2,
        opacity: 0.8,
        drag: 0.6,
      });
    }
  }

  /** Lửa + khói bốc lên từ tàu đang chìm (gọi lặp lại mỗi khung hình). */
  burning(pos, intensity = 1) {
    if (Math.random() < 0.5 * intensity) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 5)),
        vel: new THREE.Vector3((Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5)),
        color: Math.random() < 0.5 ? 0xff7a26 : 0xffc04a,
        size: 1.2 + Math.random(),
        grow: -0.4,
        life: 0.5 + Math.random() * 0.3,
        opacity: 0.95,
        additive: true,
      });
    }
    if (Math.random() < 0.35 * intensity) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 5)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 3 + Math.random() * 2, (Math.random() - 0.5) * 1.5),
        color: new THREE.Color().setScalar(0.15 + Math.random() * 0.15),
        size: 1.8 + Math.random(),
        grow: 2.5,
        life: 2.5,
        opacity: 0.6,
        drag: 0.5,
      });
    }
  }

  /** Vệt bọt nước lớn sau đuôi tàu khi "Căng buồm lướt sóng". */
  wake(ship) {
    const f = ship.forward(new THREE.Vector3());
    const side = new THREE.Vector3(f.z, 0, -f.x);
    const stern = ship.position.clone().addScaledVector(f, -ship.length * 0.5);
    stern.y = this.ocean.getHeight(stern.x, stern.z) + 0.3;
    for (let i = 0; i < 3; i++) {
      const lateral = (Math.random() - 0.5) * ship.beam * 1.2;
      this.spawn({
        pos: stern.clone().addScaledVector(side, lateral),
        vel: f.clone().multiplyScalar(-2 - Math.random() * 2).addScaledVector(side, lateral * 0.8).add(new THREE.Vector3(0, 0.6 + Math.random(), 0)),
        color: 0xf4fbff,
        size: 1.1 + Math.random() * 0.8,
        grow: 2.2,
        life: 1.2 + Math.random() * 0.6,
        opacity: 0.75,
        drag: 0.8,
      });
    }
  }

  /** Ánh sáng khi nâng cấp tàu / nhặt buff. color: màu hạt. */
  burst(pos, color = 0xffd34d) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 3, 1 + Math.random() * 3, Math.sin(a) * 3)),
        vel: new THREE.Vector3(Math.cos(a) * 1.5, 3 + Math.random() * 3, Math.sin(a) * 1.5),
        color,
        size: 0.6 + Math.random() * 0.5,
        grow: -0.6,
        life: 0.9 + Math.random() * 0.4,
        opacity: 1,
        additive: true,
      });
    }
  }

  /** Ánh vàng lấp lánh khi nhặt kho báu. */
  sparkle(pos) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 3;
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3(0, 1, 0)),
        vel: new THREE.Vector3(Math.cos(a) * r, 4 + Math.random() * 5, Math.sin(a) * r),
        color: i % 3 === 0 ? 0xffffff : 0xffd34d,
        size: 0.5 + Math.random() * 0.4,
        grow: -0.5,
        life: 0.8 + Math.random() * 0.4,
        opacity: 1,
        gravity: 10,
        additive: true,
      });
    }
  }

  /** Xoá toàn bộ hạt đang hiển thị (khi bắt đầu trận mới). */
  clear() {
    for (const p of this.particles) {
      this.scene.remove(p.s);
      p.s.material.dispose();
    }
    this.particles.length = 0;
    for (const r of this.rings) {
      this.scene.remove(r.ring);
      r.ring.geometry.dispose();
      r.ring.material.dispose();
    }
    this.rings.length = 0;
  }

  /** Đạn chạm đảo: tung bụi cát và đất. */
  impact(pos) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * r, 3 + Math.random() * 5, Math.sin(a) * r),
        color: i % 3 === 0 ? 0x8a6a3c : 0xd9c08a,
        size: 0.6 + Math.random() * 0.6,
        grow: 1,
        life: 0.9 + Math.random() * 0.5,
        opacity: 0.9,
        gravity: 14,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.spawn({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2),
        color: 0xcbb68a,
        size: 1.6,
        grow: 2.5,
        life: 1.6,
        opacity: 0.55,
        drag: 1,
      });
    }
  }

  splash(pos) {
    const y = this.ocean.getHeight(pos.x, pos.z);
    const base = new THREE.Vector3(pos.x, y, pos.z);
    // Cột nước bắn lên
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6;
      this.spawn({
        pos: base.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.3, 0.2, Math.sin(a) * r * 0.3)),
        vel: new THREE.Vector3(Math.cos(a) * r, 6 + Math.random() * 7, Math.sin(a) * r),
        color: 0xeaf6ff,
        size: 0.5 + Math.random() * 0.6,
        grow: 0.8,
        life: 1.1 + Math.random() * 0.5,
        opacity: 0.95,
        gravity: 18,
      });
    }
    // Bụi nước mờ
    for (let i = 0; i < 6; i++) {
      this.spawn({
        pos: base.clone().add(new THREE.Vector3(0, 0.6, 0)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
        color: 0xffffff,
        size: 1.5,
        grow: 2,
        life: 1.4,
        opacity: 0.45,
        drag: 1,
      });
    }
    // Vòng gợn sóng lan rộng trên mặt nước
    const mat = new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, opacity: 0.8 });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(base);
    this.scene.add(ring);
    this.rings.push({ ring, age: 0, life: 2.2 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.s);
        p.s.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      const t = p.age / p.life;
      p.s.scale.setScalar(p.size * (1 + p.grow * t));
      p.s.material.opacity = p.opacity * (1 - t) * (1 - t * 0.3);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.scene.remove(r.ring);
        r.ring.geometry.dispose();
        r.ring.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.age / r.life;
      r.ring.scale.setScalar(1.5 + t * 9);
      r.ring.position.y = this.ocean.getHeight(r.ring.position.x, r.ring.position.z) + 0.08;
      r.ring.material.opacity = 0.8 * (1 - t);
    }

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashLight.intensity = Math.max(0, this.flashTime / 0.1) * 60;
    }
  }
}
