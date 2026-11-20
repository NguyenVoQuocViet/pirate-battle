// Server nhiều người chơi: Express + Socket.io.
// Chạy: npm start
//
// Biến môi trường:
//   PORT        cổng lắng nghe (Render tự đặt). Mặc định 3001.
//   CLIENT_URL  địa chỉ trang game được phép kết nối (CORS), vd: https://pirate-battle.netlify.app
//               Nhiều địa chỉ thì cách nhau bằng dấu phẩy. Bỏ trống = cho phép mọi nơi (tiện để test).
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { NET } from '../client/src/config/game.js';
import { matchPublic, createPrivate, findRoom, roomOf, stats, SHIP_IDS } from './rooms.js';

const PORT = process.env.PORT || 3001;

/** CLIENT_URL -> danh sách origin được phép; không đặt thì '*'. */
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : '*';
const corsOptions = { origin: corsOrigin, methods: ['GET', 'POST'] };

const app = express();
app.use(cors(corsOptions));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling'], // websocket trước, polling dự phòng (mạng chặn websocket)
});

// Kiểm tra sức khoẻ: Render dùng route này để biết server đã sẵn sàng
app.get('/', (_req, res) => res.type('text/plain').send('Pirate Battle Server is running'));
app.get('/health', (_req, res) => res.json({ ok: true, ...stats() }));

io.on('connection', (socket) => {
  /**
   * Vào phòng. type: 'public' (ghép phòng chung) | 'create' (tạo phòng riêng) | 'join' (nhập mã).
   * ack({ ok, error?, room? })
   */
  socket.on('room:join', (opts = {}, ack = () => {}) => {
    if (typeof ack !== 'function') return;
    roomOf(socket)?.leave(socket); // chỉ ở một phòng tại một thời điểm
    let room;
    if (opts.type === 'create') room = createPrivate(io, opts);
    else if (opts.type === 'join') {
      room = findRoom(opts.code);
      if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng với mã này.' });
      if (room.players.length >= NET.maxPlayers) return ack({ ok: false, error: 'Phòng đã đầy.' });
    } else room = matchPublic(io, opts.mode);
    ack({ ok: true, room: room.join(socket, opts) });
  });

  socket.on('room:leave', () => roomOf(socket)?.leave(socket));

  socket.on('state', (st) => roomOf(socket)?.updateState(socket.id, st));
  socket.on('bots:state', (list) => roomOf(socket)?.updateBots(socket.id, list));
  socket.on('fire', (msg) => roomOf(socket)?.relayFire(socket, msg));
  socket.on('hit', (msg) => roomOf(socket)?.reportHit(socket, msg));
  socket.on('hurt', (msg) => roomOf(socket)?.reportHurt(socket, msg));
  socket.on('pickup', (msg) => roomOf(socket)?.pickup(socket, msg));
  socket.on('respawn', () => roomOf(socket)?.requestRespawn(socket));
  socket.on('upgrade', (msg) => roomOf(socket)?.upgrade(socket, msg));
  // Đo ping: trả về giờ server để client tính độ trễ và lệch đồng hồ (đồng bộ hướng gió)
  socket.on('ping:check', (_t, ack) => typeof ack === 'function' && ack(Date.now()));

  socket.on('disconnect', () => roomOf(socket)?.leave(socket));
});

httpServer.listen(PORT, () => {
  console.log(`Pirate Battle server đang chạy ở cổng ${PORT} (tàu: ${SHIP_IDS.length} mẫu)`);
  console.log(`CORS cho phép: ${corsOrigin === '*' ? '* (mọi nơi — đặt CLIENT_URL khi chạy thật)' : corsOrigin.join(', ')}`);
});
