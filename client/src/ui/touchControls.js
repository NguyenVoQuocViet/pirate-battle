/** Thiết bị cảm ứng? */
export const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const DEAD = 0.25; // vùng chết của joystick

/**
 * Thử vào toàn màn hình rồi khoá hướng ngang. Trình duyệt chỉ cho làm khi có thao tác chạm của
 * người chơi (và khoá hướng chỉ chạy ở chế độ toàn màn hình) — lỗi thì bỏ qua, đã có màn nhắc xoay.
 */
export async function lockLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* iOS Safari không hỗ trợ toàn màn hình cho trang */
  }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* không khoá được: người chơi tự xoay */
  }
}

/**
 * Điều khiển cảm ứng: joystick ảo góc dưới trái (đẩy lên/xuống = ga/phanh, trái/phải = bánh lái)
 * và nút bấm góc dưới phải (bắn mạn trái, bắn mạn phải, nạp đạn R, kỹ năng E).
 * Joystick ghi trực tiếp vào bảng phím (giống bấm W/A/S/D).
 */
export class TouchControls {
  constructor({ keys, onFire, onReload, onBoost }) {
    this.keys = keys;
    this.el = document.getElementById('touch');
    this.el.innerHTML = `
      <div class="joy" id="joy"><div class="joy-knob" id="joy-knob"></div></div>
      <div class="touch-btns">
        <button type="button" class="tbtn" data-act="left">Bắn<br/>trái</button>
        <button type="button" class="tbtn" data-act="right">Bắn<br/>phải</button>
        <button type="button" class="tbtn small" data-act="reload">R<br/><small>Nạp</small></button>
        <button type="button" class="tbtn small" data-act="boost">E<br/><small>Lướt</small></button>
      </div>`;
    this.joy = this.el.querySelector('#joy');
    this.knob = this.el.querySelector('#joy-knob');
    this.pointer = null;

    document.querySelector('#rotate .rotate-btn')?.addEventListener('click', () => lockLandscape());

    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    this.joy.addEventListener('pointerdown', (e) => {
      stop(e);
      if (!document.fullscreenElement) lockLandscape();
      this.pointer = e.pointerId;
      try {
        this.joy.setPointerCapture(e.pointerId);
      } catch {
        /* một số trình duyệt không cho giữ con trỏ: vẫn chạy được, chỉ kém mượt khi kéo ra ngoài */
      }
      this.move(e);
    });
    this.joy.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer) this.move(e);
    });
    const end = (e) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.knob.style.transform = '';
      this.setAxes(0, 0);
    };
    this.joy.addEventListener('pointerup', end);
    this.joy.addEventListener('pointercancel', end);

    const actions = { left: () => onFire?.('left'), right: () => onFire?.('right'), reload: () => onReload?.(), boost: () => onBoost?.() };
    this.el.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        stop(e);
        if (!document.fullscreenElement) lockLandscape();
        b.classList.add('pressed');
        actions[b.dataset.act]();
      });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  move(e) {
    const r = this.joy.getBoundingClientRect();
    const R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R;
    let dy = (e.clientY - (r.top + R)) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
    this.setAxes(dx, dy);
  }

  setAxes(x, y) {
    this.keys.KeyW = y < -DEAD;
    this.keys.KeyS = y > DEAD;
    this.keys.KeyA = x < -DEAD;
    this.keys.KeyD = x > DEAD;
  }

  setVisible(v) {
    this.el.hidden = !v;
    if (v) lockLandscape(); // thường được gọi ngay sau cú chạm "Vào trận" nên vẫn còn quyền
    if (!v) this.setAxes(0, 0);
  }
}
