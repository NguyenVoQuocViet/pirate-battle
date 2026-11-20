import * as THREE from 'three';

// Offset cố định theo trục thế giới (không xoay theo mũi tàu): góc nhìn xuống ≈ atan(31.5/29.5) ≈ 47°
// (khoảng cách tới tàu giữ ~43 như cũ, chỉ nghiêng camera về sau thêm một chút)
const BASE_OFFSET = new THREE.Vector3(0, 31.5, 29.5);
const MIN_ZOOM = 0.45; // gần nhất  ≈ 19 đơn vị
const MAX_ZOOM = 2.0; // xa nhất   ≈ 86 đơn vị
const FOLLOW_RATE = 5; // độ "dính" khi bám tàu (càng lớn càng bám sát)

/**
 * Camera top-down nghiêng: bám vị trí tàu bằng lerp, hướng nhìn cố định,
 * lăn chuột để zoom, click trái lên mặt biển để ngắm bắn theo mạn.
 */
export class CameraRig {
  constructor(camera, dom, ship) {
    this.camera = camera;
    this.dom = dom;
    this.ship = ship;
    this.zoom = 1;
    this.targetZoom = 1;
    this.shake = 0;
    this.focus = new THREE.Vector3(); // điểm camera đang nhìn (được lerp theo tàu)
    this.onSeaClick = null; // (pointWorld: Vector3) => void
    this.mode = 'follow'; // 'follow' (top-down bám tàu) | 'orbit' (menu: xoay chậm quanh tàu)
    this.orbitAngle = 0.6;
    this.leftInset = 0; // phần màn hình bên trái bị menu che (px)

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // mặt nước trung bình y = 0

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // Vị trí chuột trên màn hình (cho vùng ngắm bắn)
    this.mouse = null;
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerleave', () => (this.mouse = null));

    let downX = 0;
    let downY = 0;
    dom.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) return;
      const hit = this.pickSea(e.clientX, e.clientY);
      if (hit && this.onSeaClick) this.onSeaClick(hit);
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0012);
        this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
      },
      { passive: false },
    );
  }

  /** Chiếu tia từ trỏ chuột xuống mặt biển, trả về điểm giao trong toạ độ thế giới. */
  pickSea(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.seaPlane, new THREE.Vector3());
  }

  /** Điểm trên mặt biển dưới trỏ chuột, hoặc null. */
  mouseSeaPoint() {
    return this.mouse ? this.pickSea(this.mouse.x, this.mouse.y) : null;
  }

  setShip(ship) {
    this.ship = ship;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'orbit') this.camera.clearViewOffset();
    if (mode === 'follow' && this.ship) this.update(0, true);
  }

  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt, snap = false) {
    if (this.mode === 'orbit') {
      // Màn hình menu: camera thấp, xoay chậm quanh tàu đang chọn
      this.orbitAngle += dt * 0.18;
      const p = this.ship ? this.ship.position : new THREE.Vector3();
      const r = 24;
      this.focus.set(p.x, 3.5, p.z);
      this.camera.position.set(p.x + Math.sin(this.orbitAngle) * r, 9, p.z + Math.cos(this.orbitAngle) * r);
      this.camera.lookAt(this.focus);
      this.focus.y = 0;
      // Dời khung hình để tàu nằm ở nửa phải (bảng menu chiếm bên trái)
      const w = window.innerWidth;
      const h = window.innerHeight;
      const shift = w > 760 ? -(this.leftInset + 16) / 2 : 0;
      this.camera.setViewOffset(w, h, shift, 0, w, h);
      return;
    }
    const k = snap ? 1 : 1 - Math.exp(-FOLLOW_RATE * dt);
    this.zoom += (this.targetZoom - this.zoom) * (snap ? 1 : 1 - Math.exp(-8 * dt));

    // Bám theo vị trí tàu (bỏ qua độ nhấp nhô để camera không rung theo sóng)
    const p = this.ship.position;
    this.focus.lerp(new THREE.Vector3(p.x, 0, p.z), k);

    this.camera.position.copy(this.focus).addScaledVector(BASE_OFFSET, this.zoom);
    this.camera.lookAt(this.focus);

    if (this.shake > 0) {
      const m = this.shake * 0.35 * this.zoom;
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.z += (Math.random() - 0.5) * m;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }
}
