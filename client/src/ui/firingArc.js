import * as THREE from 'three';
import { COMBAT } from '../config/game.js';

const SPREAD = THREE.MathUtils.degToRad(7); // góc toả mỗi bên của loạt đạn
const READY = new THREE.Color(0x5fe0c8); // xanh ngọc: sẵn sàng
const BUSY = new THREE.Color(0xd9503d); // đỏ: đang nạp / hết đạn

/** Tầm bắn tối đa của loạt mạn (quỹ đạo parabol từ lỗ pháo xuống mặt nước). */
export function broadsideRange(gunHeight = 0.8) {
  const a = Math.asin(0.12 / Math.hypot(1, 0.12)); // nòng nâng như projectiles.js
  const vx = COMBAT.muzzleSpeed * Math.cos(a);
  const vy = COMBAT.muzzleSpeed * Math.sin(a);
  const g = COMBAT.gravity;
  const t = (vy + Math.sqrt(vy * vy + 2 * g * gunHeight)) / g;
  return vx * t;
}

/**
 * Dải hình quạt bán trong suốt sát mặt biển ở mạn đang ngắm:
 * mép gần dài bằng dải pháo trên thân tàu, mở rộng theo góc toả tới tầm bắn tối đa.
 */
export class FiringArc {
  constructor(scene) {
    this.scene = scene;
    this.material = new THREE.MeshBasicMaterial({
      color: READY,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: READY, transparent: true, opacity: 0.7 });
    this.group = new THREE.Group();
    this.group.renderOrder = 3;
    this.group.visible = false;
    scene.add(this.group);
    this.shipKey = null;
  }

  /** Dựng hình theo kích thước tàu (toạ độ cục bộ, mạn trái = +X). */
  build(ship) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry.dispose();
    }
    const zs = ship.guns.map((g) => g.z);
    const z0 = Math.min(...zs) - 0.8;
    const z1 = Math.max(...zs) + 0.8;
    const x0 = ship.guns[0].x + 0.4;
    const range = broadsideRange(Math.max(0.3, ship.guns[0].y + 0.4));
    const x1 = x0 + range;
    const grow = Math.tan(SPREAD) * range;
    const pts = [
      [x0, z0],
      [x0, z1],
      [x1, z1 + grow],
      [x1, z0 - grow],
    ];
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const geo = new THREE.ShapeGeometry(shape);
    // ShapeGeometry nằm trên mặt phẳng XY: đổi Y -> Z để nằm trên mặt nước
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i), 0, pos.getY(i));
    }
    geo.computeBoundingSphere();
    this.fill = new THREE.Mesh(geo, this.material);
    this.group.add(this.fill);
    const edge = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(([x, z]) => new THREE.Vector3(x, 0.02, z)));
    this.group.add(new THREE.Line(edge, this.edgeMaterial));
    this.shipKey = ship;
    this.range = range;
  }

  /** side: 'left' | 'right' | null. ready: mạn đó đã nạp xong và còn đạn. */
  update(ship, side, ready, ocean) {
    if (!ship || !side || ship.sunk) {
      this.group.visible = false;
      return;
    }
    if (this.shipKey !== ship) this.build(ship);
    this.group.visible = true;
    const p = ship.position;
    this.group.position.set(p.x, ocean.getHeight(p.x, p.z) * 0.5 + 0.55, p.z);
    this.group.rotation.set(0, ship.heading, 0);
    this.group.scale.set(side === 'left' ? 1 : -1, 1, 1);
    const col = ready ? READY : BUSY;
    this.material.color.copy(col);
    this.material.opacity = ready ? 0.22 : 0.12;
    this.edgeMaterial.color.copy(col);
    this.edgeMaterial.opacity = ready ? 0.75 : 0.35;
  }

  hide() {
    this.group.visible = false;
  }
}
