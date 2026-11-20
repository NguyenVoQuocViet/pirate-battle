import * as THREE from 'three';
import { TEAMS, CTF } from '../config/game.js';
import { tinted } from '../world/structures.js';

/**
 * Lá cờ của một cứ điểm (chế độ Cướp cờ).
 * Trạng thái: 'home' (cắm ở cứ điểm) | 'carried' (trên tàu địch) | 'dropped' (nổi trên biển).
 */
export class Flag {
  constructor({ scene, template, stronghold, ocean }) {
    this.scene = scene;
    this.ocean = ocean;
    this.stronghold = stronghold;
    this.team = stronghold.team;
    this.state = 'home';
    this.carrier = null;
    this.dropTime = 0;

    this.object = template ? tinted(template, TEAMS[this.team].color, 0.85) : new THREE.Group();
    this.object.traverse((m) => m.isMesh && (m.castShadow = true));
    // Vòng sáng khi cờ rơi trên biển
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.1, 40),
      new THREE.MeshBasicMaterial({ color: TEAMS[this.team].color, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
    this.returnHome();
  }

  /** Vị trí thế giới hiện tại của cờ. */
  get position() {
    if (this.state === 'carried' && this.carrier) return this.carrier.position;
    return this.object.position;
  }

  returnHome() {
    if (this.carrier) this.carrier.carryingFlag = null;
    this.state = 'home';
    this.carrier = null;
    this.scene.add(this.object);
    this.object.position.copy(this.stronghold.flagHome);
    this.object.scale.setScalar(1.6);
    this.object.rotation.set(0, 0.6, 0);
    this.ring.visible = false;
  }

  pickUp(ship) {
    this.state = 'carried';
    this.carrier = ship;
    ship.carryingFlag = this;
    ship.root.add(this.object);
    // Cắm ở đuôi tàu, đủ cao để nhìn thấy từ trên cao
    this.object.position.set(0, ship.height * 0.55, -ship.length * 0.3);
    this.object.scale.setScalar(1.4 / ship.type.scale);
    this.object.rotation.set(0, 0, 0);
    this.ring.visible = false;
  }

  /** Tàu giữ cờ bị chìm: cờ rơi xuống biển tại chỗ. */
  drop() {
    const ship = this.carrier;
    if (ship) ship.carryingFlag = null;
    const p = ship ? ship.position.clone() : this.object.position.clone();
    this.state = 'dropped';
    this.carrier = null;
    this.dropTime = 0;
    this.scene.add(this.object);
    this.object.position.set(p.x, 0, p.z);
    this.object.scale.setScalar(1.6);
    this.ring.visible = true;
    this.ring.position.set(p.x, 0.3, p.z);
  }

  /** Online: server báo cờ đang rơi tại (x, z). */
  setDropped(x, z) {
    if (this.carrier) this.carrier.carryingFlag = null;
    this.state = 'dropped';
    this.carrier = null;
    this.dropTime = 0;
    this.scene.add(this.object);
    this.object.position.set(x, 0, z);
    this.object.scale.setScalar(1.6);
    this.ring.visible = true;
    this.ring.position.set(x, 0.3, z);
  }

  update(dt, time) {
    if (this.state === 'dropped') {
      this.dropTime += dt;
      const p = this.object.position;
      p.y = this.ocean.getHeight(p.x, p.z, time) - 0.6;
      this.object.rotation.z = Math.sin(time * 1.5) * 0.15;
      this.ring.position.y = p.y + 0.9;
      this.ring.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4));
      return this.dropTime > CTF.dropReturnTime ? 'expired' : null;
    }
    return null;
  }

  dispose() {
    if (this.carrier) this.carrier.carryingFlag = null;
    this.object.parent?.remove(this.object);
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
