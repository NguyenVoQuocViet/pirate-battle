import * as THREE from 'three';
import { windAngle, windFactor } from '../config/game.js';

const STREAKS = 36;
const AREA = 90; // vệt gió xuất hiện quanh camera trong bán kính này
const SPEED = 14;

/**
 * Hướng gió: góc gốc theo mapSeed, xoay nhẹ theo chu kỳ dựa trên giờ (online dùng giờ server
 * nên mọi người cùng thấy một hướng gió). Vẽ các vệt gió trắng mờ lướt trên mặt biển.
 */
export class Wind {
  constructor(scene, ocean) {
    this.scene = scene;
    this.ocean = ocean;
    this.seed = 1337;
    this.angle = 0;
    this.clockOffset = 0; // ms lệch giữa đồng hồ máy này và server (online)

    const geo = new THREE.PlaneGeometry(0.35, 9);
    geo.rotateX(-Math.PI / 2); // nằm trên mặt nước, dài theo trục Z
    this.streaks = [];
    for (let i = 0; i < STREAKS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2;
      scene.add(m);
      this.streaks.push({ mesh: m, life: 0, max: 1, len: 1 });
    }
  }

  setSeed(seed) {
    this.seed = seed;
  }

  /** Giây hiện tại theo đồng hồ chung (server nếu online). */
  get nowSec() {
    return (Date.now() + this.clockOffset) / 1000;
  }

  /** Hệ số tốc độ cho một hướng mũi tàu. */
  factorFor(heading) {
    return windFactor(heading, this.angle);
  }

  update(dt, focus, time) {
    this.angle = windAngle(this.seed, this.nowSec);
    const dx = Math.sin(this.angle);
    const dz = Math.cos(this.angle);
    for (const s of this.streaks) {
      s.life += dt;
      const m = s.mesh;
      if (s.life >= s.max) {
        // Sinh lại quanh camera
        s.life = 0;
        s.max = 2 + Math.random() * 2.5;
        s.len = 0.6 + Math.random() * 1.2;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * AREA;
        m.position.set(focus.x + Math.cos(a) * r, 0, focus.z + Math.sin(a) * r);
        m.rotation.y = this.angle;
        m.scale.set(1, 1, s.len);
      }
      m.position.x += dx * SPEED * dt;
      m.position.z += dz * SPEED * dt;
      m.position.y = this.ocean.getHeight(m.position.x, m.position.z, time) + 0.35;
      const t = s.life / s.max;
      m.material.opacity = Math.sin(t * Math.PI) * 0.28;
    }
  }

  setVisible(v) {
    for (const s of this.streaks) s.mesh.visible = v;
  }
}
