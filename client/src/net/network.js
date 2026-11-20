import { io } from 'socket.io-client';
import { NET } from '../config/game.js';

/**
 * URL server Socket.io:
 * 1. Ưu tiên biến môi trường lúc build: VITE_SERVER_URL (vd: https://pirate-battle.onrender.com).
 * 2. Không có thì dùng http://<tên máy của trang>:3001 — chạy trên máy mình chính là
 *    http://localhost:3001, còn mở qua LAN (http://192.168.x.x:5173) thì tự trỏ về máy chạy server.
 */
const envUrl = (import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/+$/, '');
export const SERVER_URL = envUrl || `http://${window.location.hostname || 'localhost'}:${NET.defaultPort}`;

/** Server miễn phí (Render) ngủ khi không có ai chơi: chờ tối đa chừng này để nó thức dậy. */
export const CONNECT_TIMEOUT = 90_000;

/** Lớp mỏng bọc socket.io-client: kết nối khi cần, vào/rời phòng, gửi sự kiện. */
export class Network {
  constructor() {
    this.socket = null;
    this.handlers = {};
    this.id = null;
    this.ping = 0; // ms, khứ hồi
    this.clockOffset = 0; // ms: giờ server − giờ máy này
    this.pingTimer = null;
  }

  /** Đo độ trễ mỗi 2 giây và ước lượng lệch đồng hồ so với server. */
  startPing() {
    if (this.pingTimer) return;
    const measure = () => {
      if (!this.connected) return;
      const t0 = Date.now();
      this.socket.timeout(3000).emit('ping:check', t0, (err, serverNow) => {
        if (err || typeof serverNow !== 'number') return;
        const t1 = Date.now();
        const rtt = t1 - t0;
        this.ping = this.ping ? Math.round(this.ping * 0.6 + rtt * 0.4) : rtt;
        this.clockOffset = serverNow + rtt / 2 - t1;
      });
    };
    measure();
    this.pingTimer = setInterval(measure, 2000);
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.ping = 0;
  }

  get connected() {
    return !!this.socket?.connected;
  }

  /**
   * Gửi một request nhẹ để "đánh thức" server đang ngủ (Render gói miễn phí) ngay khi người chơi
   * chọn tab Online, trước cả khi bấm vào phòng -> rút ngắn thời gian chờ.
   */
  warmup() {
    if (this.warmedAt && Date.now() - this.warmedAt < 60_000) return;
    this.warmedAt = Date.now();
    fetch(SERVER_URL + '/', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  }

  /**
   * Kết nối (nếu chưa). onTick(giây đã chờ) được gọi mỗi giây để giao diện hiện trạng thái.
   * Trả về Promise; lỗi nếu quá thời gian hoặc người chơi bấm Huỷ.
   */
  connect(timeout = CONNECT_TIMEOUT, onTick = null) {
    if (this.connected) return Promise.resolve();
    if (!this.socket) {
      this.socket = io(SERVER_URL, {
        autoConnect: false,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 4000,
        timeout: 20_000,
      });
      for (const [ev, fns] of Object.entries(this.handlers)) for (const fn of fns) this.socket.on(ev, fn);
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setTimeout(() => {
        cleanup();
        this.socket.disconnect();
        const local = /localhost|127\.0\.0\.1|^http:\/\/(192\.168|10\.)/.test(SERVER_URL);
        reject(
          new Error(
            local
              ? `Không kết nối được server ${SERVER_URL}. Hãy chạy server: mở terminal, vào thư mục server và gõ "npm start".`
              : `Máy chủ ${SERVER_URL} không phản hồi sau ${Math.round(timeout / 1000)} giây. Thử lại sau ít phút.`,
          ),
        );
      }, timeout);
      const tick = setInterval(() => onTick?.(Math.floor((Date.now() - started) / 1000)), 1000);
      const onConnect = () => {
        cleanup();
        this.id = this.socket.id;
        resolve();
      };
      const onError = () => {}; // socket.io tự thử lại; chờ tới khi hết thời gian
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(tick);
        this.cancelConnect = null;
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
      };
      this.cancelConnect = () => {
        cleanup();
        this.socket.disconnect();
        reject(new Error('Đã huỷ kết nối.'));
      };
      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
      onTick?.(0);
      this.socket.connect();
    });
  }

  /** Huỷ lần kết nối đang chờ (nút Huỷ trên menu). */
  cancel() {
    this.cancelConnect?.();
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
    this.socket?.on(event, fn);
  }

  off(event, fn) {
    this.handlers[event] = (this.handlers[event] || []).filter((f) => f !== fn);
    this.socket?.off(event, fn);
  }

  emit(event, data) {
    if (this.connected) this.socket.emit(event, data);
  }

  /** Gửi gói "bay hơi" (mất gói không sao, vd vị trí tàu). */
  emitVolatile(event, data) {
    if (this.connected) this.socket.volatile.emit(event, data);
  }

  /** opts: { type: 'public'|'create'|'join', code?, bots?, name, shipId } -> snapshot phòng */
  async joinRoom(opts, onTick = null) {
    await this.connect(CONNECT_TIMEOUT, onTick);
    this.startPing();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server không phản hồi.')), 6000);
      this.socket.emit('room:join', opts, (res) => {
        clearTimeout(timer);
        if (res?.ok) resolve(res.room);
        else reject(new Error(res?.error || 'Không vào được phòng.'));
      });
    });
  }

  leaveRoom() {
    this.emit('room:leave');
  }
}
