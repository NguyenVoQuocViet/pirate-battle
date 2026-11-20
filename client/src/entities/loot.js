import * as THREE from 'three';
import { LOOT, BUFFS } from '../config/game.js';

/** Rương kho báu / thùng gỗ nổi bập bềnh, rơi ra khi tàu bot bị đánh chìm. */
export class Loot {
  constructor({ scene, template, kind, x, z, ocean, id = null, gold = null }) {
    this.id = id; // mã rương do server cấp (chế độ online)
    this.kind = kind;
    this.ocean = ocean;
    this.scene = scene;
    const buff = BUFFS.kinds[kind] || null;
    this.buff = buff ? buff.id : null; // thùng buff: 'fire' | 'rapid'
    const cfg = buff ? { gold: [0, 0], scale: 2.2 } : LOOT.kinds[kind];
    const [gMin, gMax] = cfg.gold;
    this.gold = gold ?? Math.round(gMin + Math.random() * (gMax - gMin));
    this.heal = buff ? 0 : LOOT.heal;
    this.lifetime = buff ? 30 : LOOT.lifetime;
    this.age = 0;
    this.collected = false;
    this.phase = Math.random() * 10;

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    if (template) {
      const m = template.clone();
      m.scale.setScalar(cfg.scale);
      m.position.y = -0.4;
      this.root.add(m);
    }
    // Vòng sáng nhẹ trên mặt nước để dễ thấy từ trên cao
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.8, 32),
      new THREE.MeshBasicMaterial({ color: buff ? buff.color : 0xffd34d, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    this.ring = ring;
    this.root.add(ring);
    if (buff) {
      // Thùng buff phát sáng: quầng sáng màu theo loại buff
      const glowTex = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      this.glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, color: buff.color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      this.glow.scale.setScalar(7);
      this.glow.position.y = 1.2;
      this.root.add(this.glow);
    }
    scene.add(this.root);
  }

  get position() {
    return this.root.position;
  }

  get expired() {
    return this.age > this.lifetime;
  }

  update(dt, time) {
    this.age += dt;
    const p = this.root.position;
    const sinkOut = Math.max(0, this.age - (this.lifetime - 3)); // chìm dần ở 3 giây cuối
    p.y = this.ocean.getHeight(p.x, p.z, time) + Math.sin(time * 2 + this.phase) * 0.15 - sinkOut * 0.8;
    this.root.rotation.y += dt * 0.4;
    this.root.rotation.z = Math.sin(time * 1.3 + this.phase) * 0.12;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4 + this.phase);
    this.ring.material.opacity = 0.3 + pulse * 0.35;
    this.ring.scale.setScalar(1 + pulse * 0.15);
    if (this.glow) this.glow.material.opacity = 0.5 + pulse * 0.45;
  }

  dispose() {
    this.scene.remove(this.root);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    if (this.glow) {
      this.glow.material.map.dispose();
      this.glow.material.dispose();
    }
  }
}
