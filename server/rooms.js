/**
 * Quản lý phòng chơi. Server là trọng tài cho: máu (HP), hạ gục, vàng, rương kho báu, hồi sinh.
 * Vị trí tàu do client sở hữu tàu gửi lên (người chơi tự gửi tàu mình, chủ phòng gửi tàu bot),
 * server gom lại và phát cho cả phòng 20 lần/giây.
 *
 * Dùng chung cấu hình với client để chỉ số tàu / luật chơi luôn khớp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildShipType, isPlayable } from '../client/src/config/shipStats.js';
import {
  NET,
  LOOT,
  COMBAT,
  RAM,
  PIRATE_NAMES,
  MODES,
  TEAMS,
  STRONGHOLDS,
  STRONGHOLD,
  CTF,
  UPGRADES,
  BUFFS,
  upgradeStats,
  emptyUpgrades,
} from '../client/src/config/game.js';

const RELOAD_TOLERANCE = 0.75; // chấp nhận loạt bắn sớm tới 25% (bù trễ mạng)
const MAX_BALL_BUDGET = 40; // số viên tối đa "đang bay" được phép báo trúng
const BURN_TICK_MS = 1000;

const FLAG_PICKUP_DROPPED = 11; // bán kính chạm cờ rơi (khớp client: 9 + nửa bán kính tàu)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../client/public/models');

/** Quét model tàu giống client (để kiểm tra shipId người chơi gửi lên). */
export const SHIP_IDS = (() => {
  try {
    return fs
      .readdirSync(MODELS_DIR)
      .filter((f) => /^ship-.*\.glb$/i.test(f))
      .map((f) => f.replace(/\.glb$/i, ''))
      .filter(isPlayable);
  } catch {
    return ['ship-pirate-medium'];
  }
})();
const DEFAULT_SHIP = SHIP_IDS.includes('ship-pirate-medium') ? 'ship-pirate-medium' : SHIP_IDS[0];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // bỏ I, O cho dễ đọc
const rooms = new Map(); // roomId -> Room

function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < NET.codeLength; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

const sanitizeName = (n) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Thuyền trưởng';
const round = (v) => Math.round(v * 100) / 100;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

class Room {
  constructor(io, { isPrivate, bots, mode = 'ffa', target }) {
    this.io = io;
    this.id = makeCode();
    this.isPrivate = isPrivate;
    this.mode = NET.modes.includes(mode) ? mode : 'ffa';
    const def = MODES[this.mode];
    this.target = def ? Math.min(def.max, Math.max(def.min, Math.round(Number(target) || def.defaultTarget))) : 0;
    this.scores = { blue: 0, red: 0 };
    this.ended = false;
    this.flags =
      this.mode === 'ctf'
        ? STRONGHOLDS.map((h) => ({ id: h.id, team: h.team, hx: h.x, hz: h.z, state: 'home', carrierId: null, x: h.x + 4.2, z: h.z + 4.2, droppedAt: 0 }))
        : [];
    this.mapSeed = Math.floor(Math.random() * 1e9);
    this.entities = new Map(); // id -> entity (người chơi + bot)
    this.loots = new Map();
    this.hostId = null;
    this.nextLoot = 1;
    this.timers = new Set();
    this.lastBoard = '';
    this.createdAt = Date.now();

    const names = [...PIRATE_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < bots; i++) {
      const shipId = SHIP_IDS[Math.floor(Math.random() * SHIP_IDS.length)];
      this.addEntity({ id: `bot-${i + 1}`, kind: 'bot', name: names[i % names.length], shipId });
    }

    this.tick = setInterval(() => {
      if (this.mode === 'ctf') this.updateFlags();
      this.updateBurns();
      this.broadcastStates();
    }, 1000 / NET.tickRate);
    rooms.set(this.id, this);
    console.log(`[room ${this.id}] tạo ${isPrivate ? 'riêng' : 'chung'} · ${this.mode}${this.target ? ' ' + this.target : ''} · ${bots} bot · seed ${this.mapSeed}`);
  }

  get isTeam() {
    return this.mode !== 'ffa';
  }

  /** Đội ít người hơn (tính cả bot) để chia đội cân bằng. */
  smallerTeam() {
    let blue = 0;
    let red = 0;
    for (const e of this.entities.values()) {
      if (e.team === 'blue') blue++;
      else if (e.team === 'red') red++;
    }
    return blue <= red ? 'blue' : 'red';
  }

  get players() {
    return [...this.entities.values()].filter((e) => e.kind === 'player');
  }

  get channel() {
    return this.io.to(this.id);
  }

  addEntity({ id, kind, name, shipId, socketId = null }) {
    const sid = SHIP_IDS.includes(shipId) ? shipId : DEFAULT_SHIP;
    const type = buildShipType(sid);
    const e = {
      id,
      kind,
      name: sanitizeName(name),
      shipId: sid,
      type,
      guns: type.guns,
      upgrades: emptyUpgrades(),
      maxHp: type.maxHp,
      damage: type.damage,
      reload: type.reload,
      hp: type.maxHp,
      buffs: { fire: 0, rapid: 0 }, // mốc hết hạn (ms)
      burnUntil: 0,
      burnBy: null,
      nextBurnAt: 0,
      volleys: { left: { id: 0, at: 0, count: 0 }, right: { id: 0, at: 0, count: 0 } },
      ballBudget: 0, // số viên đã bắn mà chưa báo trúng (chống báo trúng khống)
      cheatStrikes: 0,
      alive: true,
      deadAt: 0,
      x: 0,
      z: 0,
      h: 0,
      s: 0,
      kills: 0,
      deaths: 0,
      gold: 0,
      socketId,
      lastHitAt: 0,
      team: this.isTeam ? this.smallerTeam() : id, // chế độ tự do: mỗi tàu một "đội"
    };
    this.entities.set(id, e);
    return e;
  }

  publicEntity(e) {
    const { id, kind, name, shipId, maxHp, hp, alive, x, z, h, kills, deaths, gold, team, upgrades } = e;
    return { id, kind, name, shipId, maxHp, hp, alive, x, z, h, kills, deaths, gold, team, upgrades };
  }

  snapshot(forId) {
    return {
      roomId: this.id,
      isPrivate: this.isPrivate,
      mapSeed: this.mapSeed,
      mode: this.mode,
      target: this.target,
      scores: this.scores,
      ended: this.ended,
      flags: this.publicFlags(),
      hostId: this.hostId,
      you: forId,
      entities: [...this.entities.values()].map((e) => this.publicEntity(e)),
      loots: [...this.loots.values()],
    };
  }

  // ------------------------------------------------------------ người chơi
  join(socket, { name, shipId }) {
    const e = this.addEntity({ id: socket.id, kind: 'player', name, shipId, socketId: socket.id });
    socket.join(this.id);
    socket.data.roomId = this.id;
    if (!this.hostId) this.hostId = socket.id;
    socket.to(this.id).emit('entity:join', this.publicEntity(e));
    this.broadcastInfo();
    this.broadcastBoard(true);
    console.log(`[room ${this.id}] ${e.name} vào phòng (${this.players.length} người)`);
    return this.snapshot(socket.id);
  }

  leave(socket) {
    const e = this.entities.get(socket.id);
    if (!e) return;
    this.dropFlagOf(e);
    this.entities.delete(socket.id);
    socket.leave(this.id);
    socket.data.roomId = null;
    this.channel.emit('entity:leave', { id: socket.id });
    console.log(`[room ${this.id}] ${e.name} rời phòng (${this.players.length} người)`);

    if (this.players.length === 0) {
      this.destroy();
      return;
    }
    if (this.hostId === socket.id) {
      // Chuyển quyền chủ phòng (và quyền điều khiển bot) cho người vào sớm nhất còn lại
      this.hostId = this.players[0].id;
      this.channel.emit('room:host', { hostId: this.hostId });
    }
    this.broadcastInfo();
    this.broadcastBoard(true);
  }

  destroy() {
    clearInterval(this.tick);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    rooms.delete(this.id);
    console.log(`[room ${this.id}] trống -> đã xoá`);
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ------------------------------------------------------------ đồng bộ vị trí
  /** Người chơi gửi tàu của mình: [x, z, heading, speed] */
  updateState(socketId, st) {
    const e = this.entities.get(socketId);
    if (e && Array.isArray(st)) this.applyState(e, st);
  }

  /** Chủ phòng gửi trạng thái các bot: [[id, x, z, h, s], ...] */
  updateBots(socketId, list) {
    if (socketId !== this.hostId || !Array.isArray(list)) return;
    for (const item of list) {
      const e = this.entities.get(item?.[0]);
      if (e && e.kind === 'bot') this.applyState(e, item.slice(1));
    }
  }

  applyState(e, [x, z, h, s]) {
    if (!finite(x) || !finite(z) || !finite(h) || !finite(s)) return;
    e.x = x;
    e.z = z;
    e.h = h;
    e.s = s;
  }

  broadcastStates() {
    if (this.entities.size === 0) return;
    const ships = [];
    for (const e of this.entities.values()) ships.push([e.id, round(e.x), round(e.z), round(e.h), round(e.s)]);
    this.channel.volatile.emit('states', ships);
  }

  broadcastInfo() {
    this.channel.emit('room:info', { online: this.players.length, max: NET.maxPlayers, hostId: this.hostId });
  }

  broadcastBoard(force = false) {
    const board = [...this.entities.values()]
      .map((e) => ({ id: e.id, name: e.name, kind: e.kind, team: e.team, kills: e.kills, deaths: e.deaths, gold: e.gold }))
      .sort((a, b) => b.kills - a.kills || b.gold - a.gold);
    const key = JSON.stringify(board);
    if (!force && key === this.lastBoard) return;
    this.lastBoard = key;
    this.channel.emit('leaderboard', board);
  }

  // ------------------------------------------------------------ chiến đấu
  /** Có quyền điều khiển (và báo cáo thay) thực thể này không. */
  controls(socketId, entityId) {
    if (entityId === socketId) return true;
    const e = this.entities.get(entityId);
    return e?.kind === 'bot' && socketId === this.hostId;
  }

  /** Tính lại chỉ số sau nâng cấp. */
  recompute(e) {
    const st = upgradeStats(e.type, e.upgrades);
    e.maxHp = st.maxHp;
    e.damage = st.damage;
    e.reload = st.reload;
  }

  /** Mua nâng cấp: server kiểm tra cấp, trừ vàng, cập nhật máu tối đa / sát thương. */
  upgrade(socket, { branch } = {}) {
    const e = this.entities.get(socket.id);
    if (!e) return;
    const deny = (reason) => socket.emit('upgrade:denied', { branch, reason });
    if (!UPGRADES.branches.some((b) => b.id === branch)) return deny('Nâng cấp không hợp lệ');
    const lvl = e.upgrades[branch];
    if (lvl >= UPGRADES.maxLevel) return deny('Đã đạt cấp tối đa');
    const cost = UPGRADES.costs[lvl];
    if (e.gold < cost) return deny(`Cần ${cost} vàng (bạn có ${e.gold})`);
    e.gold -= cost;
    e.upgrades[branch] = lvl + 1;
    this.recompute(e);
    if (branch === 'hull' && e.alive) e.hp = Math.min(e.maxHp, e.hp + UPGRADES.hullHp);
    this.channel.emit('upgraded', { id: e.id, branch, level: e.upgrades[branch], gold: e.gold, maxHp: e.maxHp, hp: e.hp });
    this.broadcastBoard();
  }

  /**
   * Phát đạn cho những người khác cùng phòng thấy.
   * Chống bắn liên thanh: mỗi mạn phải chờ đủ thời gian nạp (theo loại tàu + nâng cấp + buff),
   * mỗi loạt không quá số pháo của tàu. Viên hợp lệ được cộng vào "ngân sách" báo trúng.
   */
  relayFire(socket, msg) {
    if (!msg || !Array.isArray(msg.balls) || msg.balls.length > 12) return;
    const owner = msg.ownerId;
    if (owner === 'fort') {
      if (socket.id !== this.hostId) return;
      this.fortBudget = Math.min(MAX_BALL_BUDGET, (this.fortBudget || 0) + msg.balls.length);
      msg.fire = false;
      socket.to(this.id).emit('fire', msg);
      return;
    }
    if (!this.controls(socket.id, owner)) return;
    const e = this.entities.get(owner);
    if (!e || !e.alive) return;
    const side = msg.side === 'left' || msg.side === 'right' ? msg.side : null;
    if (!side || !Number.isInteger(msg.volley)) return;
    const v = e.volleys[side];
    const now = Date.now();
    // Kiểm tra số viên trước khi ghi nhận loạt mới (loạt sai không được tính là đã bắn)
    if (msg.volley === v.id ? v.count + msg.balls.length > e.guns : msg.balls.length > e.guns) return;
    if (msg.volley !== v.id) {
      const minGap = e.reload * (e.buffs.rapid > now ? BUFFS.kinds.rapid.reloadMul : 1) * 1000 * RELOAD_TOLERANCE;
      if (v.at && now - v.at < minGap) {
        e.cheatStrikes++;
        if (e.cheatStrikes % 10 === 1) console.warn(`[room ${this.id}] từ chối loạt bắn quá nhanh của ${e.name} (${now - v.at}ms < ${Math.round(minGap)}ms)`);
        return;
      }
      v.id = msg.volley;
      v.at = now;
      v.count = 0;
    }
    if (v.count + msg.balls.length > e.guns) return; // loạt bắn nhiều viên hơn số pháo
    v.count += msg.balls.length;
    e.ballBudget = Math.min(MAX_BALL_BUDGET, e.ballBudget + msg.balls.length);
    msg.fire = !!msg.fire && e.buffs.fire > now; // chỉ có đạn lửa khi thật sự đang có buff
    socket.to(this.id).emit('fire', msg);
  }

  /**
   * Báo trúng đạn: client bắn (hoặc chủ phòng cho bot / pháo đài) phát hiện va chạm rồi báo lên.
   * Server tự tính sát thương theo loại tàu của người bắn — client không gửi số máu.
   */
  reportHit(socket, { targetId, attackerId, point } = {}) {
    const target = this.entities.get(targetId);
    if (!target || !target.alive) return;
    let attacker = null;
    let damage;
    if (attackerId === 'fort') {
      if (socket.id !== this.hostId || !(this.fortBudget > 0)) return;
      this.fortBudget--;
      damage = COMBAT.fortDamage;
    } else {
      if (!this.controls(socket.id, attackerId)) return;
      attacker = this.entities.get(attackerId);
      if (!attacker || attacker === target) return;
      if (this.isTeam && attacker.team === target.team) return; // không bắn đồng đội
      // Không báo trúng được nhiều hơn số viên thực sự đã bắn
      if (attacker.ballBudget <= 0) return;
      attacker.ballBudget--;
      damage = attacker.damage; // đã tính nâng cấp thuốc súng
    }
    // Đạn lửa: gây cháy
    const now = Date.now();
    if (attacker && attacker.buffs.fire > now && target.hp > damage) {
      const f = BUFFS.kinds.fire;
      if (target.burnUntil <= now) target.nextBurnAt = now + BURN_TICK_MS;
      target.burnUntil = now + f.burnTime * 1000;
      target.burnBy = attacker.id;
      this.channel.emit('burn', { targetId: target.id, duration: f.burnTime });
    }
    this.applyDamage(target, damage, attacker, point);
  }

  /** Tự gây sát thương (đâm vào đất liền). */
  reportHurt(socket, { targetId, cause } = {}) {
    if (!this.controls(socket.id, targetId)) return;
    const target = this.entities.get(targetId);
    if (!target || !target.alive) return;
    if (cause === 'land') this.applyDamage(target, RAM.damage, null, null, 'đá ngầm');
  }

  applyDamage(target, damage, attacker, point, causeName = null) {
    target.hp = Math.max(0, target.hp - damage);
    const p = Array.isArray(point) && point.every(finite) ? point : [target.x, 2, target.z];
    this.channel.emit('damage', { targetId: target.id, attackerId: attacker?.id ?? null, amount: damage, hp: target.hp, point: p });
    if (target.hp > 0) return;

    target.alive = false;
    target.deadAt = Date.now();
    target.deaths++;
    target.burnUntil = 0;
    target.buffs.fire = target.buffs.rapid = 0;
    // Bị chìm: giữ nâng cấp, giữ lại 50% vàng
    if (target.kind === 'player') target.gold = Math.floor(target.gold * UPGRADES.keepGoldOnDeath);
    if (attacker) {
      attacker.kills++;
      attacker.gold += NET.killGold;
    }
    this.dropFlagOf(target);
    this.channel.emit('sunk', {
      targetId: target.id,
      targetName: target.name,
      attackerId: attacker?.id ?? null,
      attackerName: attacker ? attacker.name : causeName || 'pháo đài',
      killGold: attacker ? NET.killGold : 0,
    });
    this.spawnLoot(target.x, target.z);
    this.broadcastBoard();
    // Cộng điểm đội sau cùng: có thể kết thúc trận, lúc đó bảng xếp hạng đã cập nhật
    if (this.mode === 'tdm' && attacker && attacker.team !== target.team) this.addScore(attacker.team);

    if (target.kind === 'bot') this.later(NET.botRespawnDelay * 1000, () => this.respawn(target));
  }

  /** Sát thương cháy của đạn lửa: 4 HP mỗi giây trong 4 giây. */
  updateBurns() {
    const now = Date.now();
    for (const e of this.entities.values()) {
      if (!e.alive || !e.burnUntil) continue;
      if (now > e.burnUntil + 50) {
        e.burnUntil = 0;
        continue;
      }
      if (now >= e.nextBurnAt) {
        e.nextBurnAt += BURN_TICK_MS;
        const by = this.entities.get(e.burnBy) || null;
        this.applyDamage(e, BUFFS.kinds.fire.burnDps, by, [e.x, 3, e.z], 'lửa');
      }
    }
  }

  // ------------------------------------------------------------ chế độ đội
  addScore(team) {
    if (this.ended) return;
    this.scores[team]++;
    this.channel.emit('scores', { scores: this.scores });
    if (this.scores[team] >= this.target) this.endMatch(team);
  }

  endMatch(winner) {
    this.ended = true;
    this.channel.emit('match:end', { winner, scores: this.scores, resetIn: NET.resetDelay });
    console.log(`[room ${this.id}] đội ${winner} thắng ${this.scores.blue}-${this.scores.red}`);
    this.later(NET.resetDelay * 1000, () => this.resetMatch());
  }

  /** Trận mới trong cùng phòng: xoá tỉ số, cờ về chỗ, mọi tàu hồi sinh, xoá nâng cấp & vàng. */
  resetMatch() {
    this.ended = false;
    this.scores = { blue: 0, red: 0 };
    for (const f of this.flags) this.flagHome(f, false);
    for (const e of this.entities.values()) {
      e.upgrades = emptyUpgrades();
      e.gold = 0;
      this.recompute(e);
      e.burnUntil = 0;
      e.buffs.fire = e.buffs.rapid = 0;
      e.alive = true;
      e.hp = e.maxHp;
    }
    this.channel.emit('match:reset', { scores: this.scores, flags: this.publicFlags() });
    this.broadcastBoard(true); // vàng đã về 0
  }

  publicFlags() {
    return this.flags.map(({ id, team, state, carrierId, x, z }) => ({ id, team, state, carrierId, x: round(x), z: round(z) }));
  }

  emitFlags() {
    this.channel.emit('flags', this.publicFlags());
  }

  ctfEvent(text, team) {
    this.channel.emit('ctf:event', { text, team });
  }

  flagHome(f, emit = true) {
    f.state = 'home';
    f.carrierId = null;
    f.x = f.hx + 4.2;
    f.z = f.hz + 4.2;
    if (emit) this.emitFlags();
  }

  dropFlagOf(e) {
    const f = this.flags.find((fl) => fl.carrierId === e.id);
    if (!f) return;
    f.state = 'dropped';
    f.carrierId = null;
    f.x = e.x;
    f.z = e.z;
    f.droppedAt = Date.now();
    this.ctfEvent(`${e.name} làm rơi cờ ${TEAMS[f.team].name}`, f.team);
    this.emitFlags();
  }

  /** Luật cướp cờ, chạy 20 lần/giây trên vị trí tàu mới nhất. */
  updateFlags() {
    const now = Date.now();
    const zone = STRONGHOLD.zoneRadius + NET.flagTolerance;
    for (const f of this.flags) {
      if (f.state === 'dropped' && now - f.droppedAt > CTF.dropReturnTime * 1000) {
        this.flagHome(f);
        this.ctfEvent(`Cờ ${TEAMS[f.team].name} đã tự về cứ điểm`, f.team);
      }
      if (f.state === 'carried') {
        const c = this.entities.get(f.carrierId);
        if (c) {
          f.x = c.x;
          f.z = c.z;
        }
      }
    }
    if (this.ended) return;

    for (const e of this.entities.values()) {
      if (!e.alive || (e.x === 0 && e.z === 0)) continue;
      const carrying = this.flags.find((fl) => fl.carrierId === e.id);
      if (carrying) {
        const home = STRONGHOLDS.find((h) => h.team === e.team && Math.hypot(h.x - e.x, h.z - e.z) < zone);
        if (home) {
          this.flagHome(carrying);
          if (e.kind === 'player') e.gold += NET.killGold;
          this.ctfEvent(`${e.name} cướp cờ thành công! +1 ${TEAMS[e.team].name}`, e.team);
          this.broadcastBoard(); // gửi trước để bảng kết thúc trận có số vàng mới nhất
          this.addScore(e.team);
        }
        continue;
      }
      for (const f of this.flags) {
        if (f.state === 'carried') continue;
        const d = Math.hypot(f.x - e.x, f.z - e.z);
        if (f.team === e.team) {
          if (f.state === 'dropped' && d < FLAG_PICKUP_DROPPED + NET.flagTolerance) {
            this.flagHome(f);
            this.ctfEvent(`${e.name} đã thu hồi cờ ${TEAMS[f.team].name}`, f.team);
          }
          continue;
        }
        const near = f.state === 'home' ? Math.hypot(f.hx - e.x, f.hz - e.z) < zone : d < FLAG_PICKUP_DROPPED + NET.flagTolerance;
        if (near) {
          f.state = 'carried';
          f.carrierId = e.id;
          this.ctfEvent(`${e.name} đã cướp cờ ${TEAMS[f.team].name}!`, e.team);
          this.emitFlags();
          break;
        }
      }
    }
  }

  /** Người chơi bấm "Hồi sinh ngay". */
  requestRespawn(socket) {
    const e = this.entities.get(socket.id);
    if (!e || e.alive) return;
    if (Date.now() - e.deadAt < NET.minRespawnDelay * 1000) return;
    this.respawn(e);
  }

  respawn(e) {
    if (!this.entities.has(e.id)) return;
    e.alive = true;
    e.hp = e.maxHp;
    this.channel.emit('respawned', { id: e.id, hp: e.hp });
  }

  // ------------------------------------------------------------ rương kho báu
  spawnLoot(x, z) {
    const kind = Math.random() < LOOT.kinds.chest.chance ? 'chest' : 'barrel';
    const [gMin, gMax] = LOOT.kinds[kind].gold;
    const loot = {
      id: `L${this.nextLoot++}`,
      kind,
      x: round(x),
      z: round(z),
      gold: Math.round(gMin + Math.random() * (gMax - gMin)),
    };
    this.loots.set(loot.id, loot);
    this.channel.emit('loot:spawn', loot);
    this.later(LOOT.lifetime * 1000, () => {
      if (this.loots.delete(loot.id)) this.channel.emit('loot:remove', { lootId: loot.id });
    });
    // Thùng buff phát sáng (đạn lửa / nạp đạn thần tốc)
    if (Math.random() < BUFFS.dropChance) {
      const a = Math.random() * Math.PI * 2;
      const buff = {
        id: `L${this.nextLoot++}`,
        kind: Math.random() < 0.5 ? 'fire' : 'rapid',
        x: round(x + Math.cos(a) * 7),
        z: round(z + Math.sin(a) * 7),
        gold: 0,
      };
      buff.buff = buff.kind;
      this.loots.set(buff.id, buff);
      this.channel.emit('loot:spawn', buff);
      this.later(30000, () => {
        if (this.loots.delete(buff.id)) this.channel.emit('loot:remove', { lootId: buff.id });
      });
    }
  }

  /** Ai chạm trước được server xác nhận. */
  pickup(socket, { lootId } = {}) {
    const loot = this.loots.get(lootId);
    const e = this.entities.get(socket.id);
    if (!loot || !e || !e.alive) return;
    if (Math.hypot(e.x - loot.x, e.z - loot.z) > NET.pickupTolerance) return;
    this.loots.delete(lootId);
    if (loot.buff) {
      e.buffs[loot.buff] = Date.now() + BUFFS.duration * 1000;
      this.channel.emit('loot:taken', { lootId, by: e.id, byName: e.name, heal: 0, hp: e.hp, gold: 0, buff: loot.buff });
      return;
    }
    const before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + LOOT.heal);
    e.gold += loot.gold;
    this.channel.emit('loot:taken', { lootId, by: e.id, byName: e.name, heal: e.hp - before, hp: e.hp, gold: loot.gold });
    this.broadcastBoard();
  }
}

// ------------------------------------------------------------ API cho index.js
export function findRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim()) || null;
}

/** Tìm phòng chung còn chỗ, không có thì tạo mới. */
/** Tìm phòng chung cùng chế độ còn chỗ, không có thì tạo mới. */
export function matchPublic(io, mode = 'ffa') {
  const m = NET.modes.includes(mode) ? mode : 'ffa';
  for (const r of rooms.values()) {
    if (!r.isPrivate && r.mode === m && r.players.length < NET.maxPlayers) return r;
  }
  return new Room(io, { isPrivate: false, mode: m, bots: m === 'ffa' ? NET.publicBots : NET.publicTeamBots });
}

export function createPrivate(io, { bots, mode, target } = {}) {
  const n = NET.privateBotOptions.includes(Number(bots)) ? Number(bots) : 0;
  return new Room(io, { isPrivate: true, bots: n, mode, target });
}

export function roomOf(socket) {
  return rooms.get(socket.data.roomId) || null;
}

export function stats() {
  return {
    rooms: rooms.size,
    players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
    list: [...rooms.values()].map((r) => ({ id: r.id, private: r.isPrivate, mode: r.mode, scores: r.scores, players: r.players.length, bots: r.entities.size - r.players.length })),
  };
}
