import * as THREE from 'three';
import { Ship } from '../entities/ship.js';
import { Loot } from '../entities/loot.js';
import { thinkBot, createBotMemory } from '../ai/botBrain.js';
import { getShipType } from '../config/ships.js';
import { WORLD, LOOT, NET, RAM, TEAMS, MODES, UPGRADES, BUFFS, emptyUpgrades } from '../config/game.js';
import { Flag } from '../entities/flag.js';
import { ctfBotGoal, assignCtfRoles } from '../modes/captureFlag.js';
import { tdmBotGoal } from '../modes/teamDeathmatch.js';

const NO_INPUT = { forward: false, backward: false, left: false, right: false };

/**
 * Một trận online (phòng chung hoặc phòng riêng).
 * Chế độ: 'ffa' (tự do, ai cũng là đối thủ) | 'tdm' (đối đầu đồng đội) | 'ctf' (cướp cờ).
 * Với chế độ đội, server chia đội, tính tỉ số và là trọng tài trạng thái cờ.
 *
 * Phân quyền:
 * - Mỗi client tự lái tàu của mình, gửi [x, z, heading, speed] 20 lần/giây.
 * - Chủ phòng (host) chạy AI + vật lý cho bot và pháo đài, gửi trạng thái bot lên server.
 * - Ai bắn (hoặc host thay bot/pháo đài) thì tự phát hiện trúng và báo server.
 * - Server là trọng tài: trừ máu theo sát thương của loại tàu, hạ gục, vàng, rương, hồi sinh.
 */
export class OnlineSession {
  constructor(game, net, room) {
    this.game = game;
    this.net = net;
    this.roomId = room.roomId;
    this.isPrivate = room.isPrivate;
    this.myId = room.you;
    this.hostId = room.hostId;
    this.mode = room.mode || 'ffa';
    this.target = room.target || 0;
    this.scores = room.scores || { blue: 0, red: 0 };
    this.ended = !!room.ended;
    this.matchEnd = null;
    this.flags = [];
    this.ships = new Map(); // id -> Ship
    this.loots = new Map(); // id -> Loot
    this.sendAcc = 0;
    this.pickupPending = new Set();
    this.stats = { kills: 0, deaths: 0, gold: 0, damage: 0 };
    this.deathInfo = null;
    this.handlers = [];

    if (this.mode === 'ctf') {
      this.flags = game.strongholds.map(
        (h) => new Flag({ scene: game.scene, template: game.structureModels['flag-high'], stronghold: h, ocean: game.ocean }),
      );
    }
    for (const e of room.entities) this.addEntity(e);
    for (const l of room.loots) this.addLoot(l);
    this.applyFlags(room.flags || []);
    this.assignRoles();
    // Sự kiện phát ngay lúc vào phòng có thể tới trước khi kịp đăng ký -> dựng sẵn từ snapshot
    this.online = room.entities.filter((e) => e.kind === 'player').length;
    this.board = room.entities
      .map(({ id, name, kind, team, kills, deaths, gold }) => ({ id, name, kind, team, kills, deaths, gold }))
      .sort((a, b) => b.kills - a.kills || b.gold - a.gold);
    this.me = this.ships.get(this.myId);
    this.placeLocal(this.me);
    this.setupProjectiles();
    this.bind();
  }

  get isHost() {
    return this.hostId === this.myId;
  }

  get isTeam() {
    return this.mode !== 'ffa';
  }

  get shipList() {
    return [...this.ships.values()];
  }

  // ------------------------------------------------------------ thực thể
  addEntity(e) {
    if (this.ships.has(e.id)) return this.ships.get(e.id);
    const g = this.game;
    const type = getShipType(e.shipId);
    const isMe = e.id === this.myId;
    const team = this.isTeam ? e.team : e.id; // tự do: mỗi tàu một "đội" để ai cũng là đối thủ
    const ship = new Ship({ type, template: g.shipTemplates[type.id], ocean: g.ocean, name: e.name, team, isPlayer: isMe });
    ship.netId = e.id;
    ship.kind = e.kind;
    ship.upgrades = { ...emptyUpgrades(), ...(e.upgrades || {}) };
    ship.applyUpgrades();
    ship.maxHp = e.maxHp;
    ship.hp = e.hp;
    ship.kills = e.kills;
    ship.deaths = e.deaths;
    ship.gold = e.gold;
    if (!isMe) {
      if (e.kind === 'bot' && this.isHost) this.makeLocalBot(ship);
      else ship.remote = true;
      if (e.x || e.z) ship.setNetState(e.x, e.z, e.h, 0);
      else if (!ship.remote) this.placeLocal(ship);
    }
    if (!e.alive) this.markDead(ship, true);
    g.scene.add(ship.root);
    this.ships.set(e.id, ship);
    return ship;
  }

  makeLocalBot(ship) {
    ship.remote = false;
    ship.brain = createBotMemory();
  }

  /** Cướp cờ: chia vai tấn công / phòng thủ cho các bot mình điều khiển. */
  assignRoles() {
    if (this.mode !== 'ctf' || !this.isHost) return;
    assignCtfRoles(
      this.shipList.filter((s) => s.kind === 'bot' && !s.remote),
      this.game.strongholds,
    );
  }

  /** Áp trạng thái cờ do server gửi: home | carried | dropped. */
  applyFlags(list) {
    for (const st of list) {
      const flag = this.flags.find((f) => f.stronghold.id === st.id);
      if (!flag) continue;
      if (st.state === 'home') {
        if (flag.state !== 'home') flag.returnHome();
      } else if (st.state === 'carried') {
        const carrier = this.ships.get(st.carrierId);
        if (carrier && flag.carrier !== carrier) flag.pickUp(carrier);
      } else if (st.state === 'dropped') {
        if (flag.state !== 'dropped' || flag.object.position.distanceTo(new THREE.Vector3(st.x, flag.object.position.y, st.z)) > 1) {
          flag.setDropped(st.x, st.z);
        }
      }
    }
  }

  removeEntity(id) {
    const ship = this.ships.get(id);
    if (!ship) return;
    if (ship.carryingFlag) ship.carryingFlag.setDropped(ship.position.x, ship.position.z);
    ship.dispose(this.game.scene);
    this.ships.delete(id);
  }

  /** Đặt tàu (của mình / bot khi là host) ở vùng nước trống, tránh đảo, pháo đài và tàu khác. */
  placeLocal(ship) {
    const isl = this.game.islands;
    if (this.isTeam) {
      // Chế độ đội: hồi sinh quanh cứ điểm của đội mình
      const bases = this.game.strongholds.filter((h) => h.team === ship.team);
      for (let tries = 0; tries < 60; tries++) {
        const base = bases[Math.floor(Math.random() * bases.length)];
        const a = Math.random() * Math.PI * 2;
        const d = 28 + Math.random() * 30;
        const x = base.x + Math.cos(a) * d;
        const z = base.z + Math.sin(a) * d;
        if (!isl.isOpenWater(x, z, 10, false)) continue;
        if (tries < 50 && this.shipList.some((s) => s !== ship && !s.sunk && Math.hypot(s.position.x - x, s.position.z - z) < 14)) continue;
        ship.respawn(x, z, Math.atan2(-x * 0.3, -z));
        return;
      }
    }
    for (let tries = 0; tries < 80; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * (WORLD.radius * 0.85 - 60);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!isl.isOpenWater(x, z, 14, tries < 60)) continue;
      if (this.shipList.some((s) => s !== ship && !s.sunk && Math.hypot(s.position.x - x, s.position.z - z) < 45)) continue;
      ship.respawn(x, z, Math.atan2(-x, -z));
      return;
    }
    ship.respawn(0, 0, Math.PI);
  }

  markDead(ship, instant = false) {
    ship.sunk = true;
    ship.hp = 0;
    ship.sinkTime = instant ? 99 : 0;
    ship.resupply = 0;
    if (instant) ship.root.visible = false;
  }

  addLoot(l) {
    if (this.loots.has(l.id)) return;
    const g = this.game;
    this.loots.set(l.id, new Loot({ scene: g.scene, template: g.lootTemplates[l.kind] || g.structureModels.crate, kind: l.kind, x: l.x, z: l.z, ocean: g.ocean, id: l.id, gold: l.gold }));
  }

  removeLoot(id) {
    const l = this.loots.get(id);
    if (!l) return null;
    l.dispose();
    this.loots.delete(id);
    this.pickupPending.delete(id);
    return l;
  }

  // ------------------------------------------------------------ đạn
  setupProjectiles() {
    const p = this.game.projectiles;
    // Chỉ được bắn thay tàu mình điều khiển
    p.canFire = (ship) => ship === this.me || (this.isHost && ship.kind === 'bot' && !ship.remote);
    p.onLaunch = ({ pos, vel, kind, owner, side, volley, fire }) => {
      this.net.emit('fire', {
        ownerId: owner ? owner.netId : 'fort',
        kind,
        side,
        volley,
        fire: !!fire,
        balls: [[pos.x, pos.y, pos.z, vel.x, vel.y, vel.z].map((v) => Math.round(v * 100) / 100)],
      });
    };
    // Đạn của máy này trúng tàu -> báo server (server tự tính sát thương)
    p.onHit = (target, _dmg, attacker, point) => {
      this.net.emit('hit', {
        targetId: target.netId,
        attackerId: attacker ? attacker.netId : 'fort',
        point: [point.x, point.y, point.z].map((v) => Math.round(v * 10) / 10),
      });
    };
    p.onBroadside = (ship) => {
      if (ship === this.me) this.game.rig.addShake(0.25);
    };
  }

  // ------------------------------------------------------------ sự kiện mạng
  bind() {
    const on = (ev, fn) => {
      this.net.on(ev, fn);
      this.handlers.push([ev, fn]);
    };
    const g = this.game;
    const hud = g.hud;

    on('states', (list) => {
      for (const [id, x, z, h, s] of list) {
        const ship = this.ships.get(id);
        if (ship && ship.remote) ship.setNetState(x, z, h, s);
      }
    });

    on('entity:join', (e) => {
      this.addEntity(e);
      if (e.kind === 'player') hud.toast(`${e.name} đã vào phòng${this.isTeam ? ` · đội ${TEAMS[e.team].name}` : ''}`, this.isTeam ? e.team : null);
    });

    on('scores', ({ scores }) => {
      this.scores = scores;
    });
    on('flags', (list) => this.applyFlags(list));
    on('ctf:event', ({ text, team }) => {
      hud.toast(text, team);
      if (/thành công/.test(text)) g.sound.coin();
    });
    on('match:end', ({ winner, scores, resetIn }) => {
      this.scores = scores;
      this.ended = true;
      this.matchEnd = { winner, until: performance.now() + resetIn * 1000 };
      g.career.add('matches');
      if (winner === this.me.team) g.career.add('wins');
      g.onlineHud.showMatchEnd({ winner, scores, target: this.target, mode: this.mode, myTeam: this.me.team, stats: this.stats });
    });
    on('match:reset', ({ scores, flags }) => {
      for (const s of this.shipList) {
        s.upgrades = emptyUpgrades();
        s.applyUpgrades();
      }
      this.scores = scores;
      this.ended = false;
      this.matchEnd = null;
      this.applyFlags(flags);
      g.onlineHud.hideMatchEnd();
      g.onlineHud.hideDeath();
      this.deathInfo = null;
      // Mọi tàu hồi sinh tại cứ điểm (tàu mình + bot nếu là chủ phòng)
      for (const s of this.shipList) {
        s.root.visible = true;
        if (s === this.me || !s.remote) this.placeLocal(s);
        else {
          s.respawn(s.position.x, s.position.z, s.heading);
          s.net = null;
        }
      }
      hud.toast('Trận mới bắt đầu!', this.me.team);
    });

    on('entity:leave', ({ id }) => {
      const ship = this.ships.get(id);
      if (ship) hud.toast(`${ship.name} đã rời phòng`, null);
      this.removeEntity(id);
    });

    on('room:info', ({ online, hostId }) => {
      this.online = online;
      if (hostId) this.setHost(hostId);
    });

    on('room:host', ({ hostId }) => this.setHost(hostId));

    on('fire', ({ ownerId, kind, balls, fire }) => {
      const owner = ownerId === 'fort' ? null : this.ships.get(ownerId) || null;
      for (const b of balls || []) {
        const pos = new THREE.Vector3(b[0], b[1], b[2]);
        const vel = new THREE.Vector3(b[3], b[4], b[5]);
        g.projectiles.launch(pos, vel, { owner, kind: kind === 'player' ? 'bot' : kind, remote: true, fire: !!fire });
        g.effects.muzzle(pos, vel.clone().normalize(), owner ? owner.velocity : new THREE.Vector3());
      }
    });

    on('damage', ({ targetId, attackerId, amount, hp, point }) => {
      const ship = this.ships.get(targetId);
      if (!ship) return;
      ship.hp = hp;
      const p = new THREE.Vector3(...point);
      hud.floatText(p, `-${amount}`, ship === this.me ? 'dmg-self' : 'dmg');
      if (ship === this.me) {
        g.rig.addShake(0.6);
        hud.flashHit();
      }
      if (attackerId === this.myId) this.stats.damage += amount;
    });

    on('sunk', ({ targetId, targetName, attackerId, attackerName, killGold }) => {
      const ship = this.ships.get(targetId);
      if (ship) {
        this.markDead(ship);
        g.effects.shipExplosion(ship.position.clone());
        g.sound.explode(ship.position.clone());
      }
      const atk = attackerId ? this.ships.get(attackerId) : null;
      const tone = (s) => (this.isTeam ? s?.team : s === this.me ? 'blue' : 'red');
      hud.killFeed(attackerName, atk ? tone(atk) : null, targetName, tone(ship));
      if (attackerId === this.myId && ship) {
        hud.floatText(ship.position.clone().add(new THREE.Vector3(0, 6, 0)), `Hạ gục! +${killGold} vàng`, 'kill');
        g.career.add('kills');
      }
      if (ship) {
        ship.buffs.fire = ship.buffs.rapid = 0;
        ship.burnVisual = 0;
      }
      if (targetId === this.myId) {
        this.deathInfo = { by: attackerName, at: performance.now() };
        g.onlineHud.showDeath(attackerName, attackerId === null);
      }
    });

    on('respawned', ({ id, hp }) => {
      const ship = this.ships.get(id);
      if (!ship) return;
      ship.root.visible = true;
      if (ship === this.me || !ship.remote) {
        this.placeLocal(ship); // reset máu, đạn, vị trí
      } else {
        ship.respawn(ship.position.x, ship.position.z, ship.heading);
        ship.net = null; // trạng thái kế tiếp sẽ dịch chuyển tức thì
      }
      ship.hp = hp;
      if (ship === this.me) {
        this.deathInfo = null;
        g.onlineHud.hideDeath();
        hud.toast('Đã hồi sinh', 'blue');
      }
    });

    on('loot:spawn', (l) => this.addLoot(l));
    on('loot:remove', ({ lootId }) => this.removeLoot(lootId));
    on('loot:taken', ({ lootId, by, heal, hp, gold, buff }) => {
      const l = this.removeLoot(lootId);
      const ship = this.ships.get(by);
      if (ship) ship.hp = hp;
      if (buff && ship) {
        ship.applyBuff(buff);
        if (by === this.myId) {
          const b = BUFFS.kinds[buff];
          if (l) {
            hud.floatText(l.position, `${b.name}!`, 'gold');
            g.effects.burst(l.position.clone(), b.color);
          }
          hud.toast(`${b.name}: hiệu lực ${BUFFS.duration} giây`, 'warn');
          g.sound.powerup();
        }
        return;
      }
      if (by === this.myId && l) {
        hud.floatText(l.position, `+${gold} vàng`, 'gold');
        if (heal > 0) hud.floatText(l.position.clone().add(new THREE.Vector3(0, 2, 0)), `+${Math.round(heal)} HP`, 'heal');
        g.effects.sparkle(l.position);
        g.sound.coin();
      }
    });

    on('leaderboard', (board) => {
      this.board = board;
      const mine = board.find((b) => b.id === this.myId);
      if (mine) {
        // Thống kê cá nhân: cộng phần vàng tăng thêm (tiêu hoặc mất khi chìm thì không trừ)
        if (this.statsReady && mine.gold > this.stats.gold) g.career.add('gold', mine.gold - this.stats.gold);
        this.statsReady = true;
        Object.assign(this.stats, { kills: mine.kills, deaths: mine.deaths, gold: mine.gold });
      }
    });

    on('upgraded', ({ id, branch, level, gold, maxHp, hp }) => {
      const ship = this.ships.get(id);
      if (!ship) return;
      ship.upgrades[branch] = level;
      ship.applyUpgrades();
      ship.maxHp = maxHp;
      ship.hp = hp;
      if (ship === this.me) {
        this.stats.gold = gold;
        g.onUpgraded(ship, UPGRADES.branches.findIndex((b) => b.id === branch));
      }
    });
    on('upgrade:denied', ({ branch, reason }) => {
      g.upgradeDenied(UPGRADES.branches.findIndex((b) => b.id === branch), reason);
    });
    on('burn', ({ targetId, duration }) => {
      const ship = this.ships.get(targetId);
      if (ship) ship.burnVisual = duration;
    });

    on('disconnect', () => g.leaveOnline('Mất kết nối tới server.'));
  }

  setHost(hostId) {
    if (hostId === this.hostId) return;
    const wasHost = this.isHost;
    this.hostId = hostId;
    if (this.isHost && !wasHost) {
      // Nhận quyền điều khiển bot từ chủ phòng cũ, tiếp tục từ vị trí cuối cùng
      for (const s of this.ships.values()) if (s.kind === 'bot') this.makeLocalBot(s);
      this.assignRoles();
      this.game.hud.toast('Bạn là chủ phòng mới (điều khiển bot)', 'blue');
    } else if (!this.isHost && wasHost) {
      for (const s of this.ships.values()) if (s.kind === 'bot') s.remote = true;
    }
  }

  scoreboardData() {
    const def = MODES[this.mode];
    return {
      title: `Phòng ${this.roomId}`,
      sub: `${this.isPrivate ? 'Phòng riêng' : 'Phòng chung'} · ${def?.name ?? 'Tự do'} · ${this.online} người online`,
      teamMode: this.isTeam,
      scores: this.scores,
      target: this.target,
      unit: this.mode === 'ctf' ? 'cờ' : 'tàu',
      rows: this.board.map((b) => {
        const ship = this.ships.get(b.id);
        return {
          name: b.name,
          team: b.team,
          kills: b.kills,
          deaths: b.deaths,
          gold: b.gold,
          isMe: b.id === this.myId,
          isBot: b.kind === 'bot',
          alive: ship ? !ship.sunk : true,
          carrying: !!ship?.carryingFlag,
        };
      }),
    };
  }

  /** Nâng cấp online: kiểm tra sơ bộ rồi để server trừ vàng và xác nhận. */
  buyUpgrade(index) {
    const b = UPGRADES.branches[index];
    const lvl = this.me.upgrades[b.id];
    if (lvl >= UPGRADES.maxLevel) return this.game.upgradeDenied(index, `${b.name} đã đạt cấp tối đa`);
    const cost = UPGRADES.costs[lvl];
    if (this.stats.gold < cost) return this.game.upgradeDenied(index, `Cần ${cost} vàng để nâng ${b.short}`);
    this.net.emit('upgrade', { branch: b.id });
  }

  respawnRequest() {
    this.net.emit('respawn');
  }

  // ------------------------------------------------------------ vòng lặp
  botGoal(bot) {
    const ctx = { ships: this.shipList, strongholds: this.game.strongholds, flags: this.flags };
    if (this.mode === 'ctf') return ctfBotGoal(bot, ctx);
    if (this.mode === 'tdm') return tdmBotGoal(bot, ctx);
    let best = null;
    let bestD = Infinity;
    for (const s of this.ships.values()) {
      if (s === bot || s.sunk) continue;
      const d = Math.hypot(s.position.x - bot.position.x, s.position.z - bot.position.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? { x: best.position.x, z: best.position.z } : null;
  }

  /** Va chạm cho tàu do máy này điều khiển. Đâm đất liền -> báo server trừ máu. */
  collideLocal(ship) {
    const g = this.game;
    const speedBefore = Math.abs(ship.speed);
    if (g.islands.collideShip(ship) && speedBefore > RAM.minSpeed && ship.groundCooldown <= 0) {
      ship.groundCooldown = RAM.cooldown;
      ship.speed *= -0.25;
      const p = ship.position.clone().add(new THREE.Vector3(0, 1, 0));
      g.effects.impact(p);
      g.sound.hit(p);
      if (ship === this.me) g.hud.toast(`Đâm vào đất liền! -${RAM.damage} HP`, 'warn');
      this.net.emit('hurt', { targetId: ship.netId, cause: 'land' });
    }
    for (const st of g.strongholds) st.collide(ship);
    for (const d of g.depots) d.collide(ship);
    // Tàu khác chỉ đẩy tàu mình ra (tàu kia do máy khác điều khiển)
    for (const o of this.ships.values()) {
      if (o === ship || o.sunk) continue;
      const dx = ship.position.x - o.position.x;
      const dz = ship.position.z - o.position.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const minD = (ship.radius + o.radius) * 0.62;
      if (d < minD) {
        const push = o.remote ? minD - d : (minD - d) / 2;
        ship.position.x += (dx / d) * push;
        ship.position.z += (dz / d) * push;
        ship.speed *= 0.92;
      }
    }
    const r = Math.hypot(ship.position.x, ship.position.z);
    if (r > WORLD.hardLimit) {
      ship.position.x *= WORLD.hardLimit / r;
      ship.position.z *= WORLD.hardLimit / r;
    }
  }

  update(dt, elapsed, inputEnabled) {
    const g = this.game;
    const keys = g.keys;
    const me = this.me;
    const input =
      inputEnabled && !me.sunk
        ? { forward: keys.KeyW || keys.ArrowUp, backward: keys.KeyS || keys.ArrowDown, left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight }
        : NO_INPUT;
    me.update(dt, input, elapsed);
    g.updateResupply(me, g.playerReloadRequest, dt);
    g.playerReloadRequest = false;
    if (!me.sunk) this.collideLocal(me);

    // Bot (chỉ chủ phòng chạy AI)
    const ships = this.shipList;
    if (this.isHost) {
      const alive = ships.filter((s) => !s.sunk);
      const snaps = alive.map((s) => s.snapshot());
      const base = { time: elapsed, dt, ...g.obstacles, worldRadius: WORLD.radius };
      for (const bot of ships) {
        if (bot.kind !== 'bot' || bot.remote) continue;
        if (bot.sunk) {
          bot.update(dt, NO_INPUT, elapsed);
          continue;
        }
        // Chỉ nhắm tàu khác đội (chế độ tự do: mỗi tàu một "đội" nên ai cũng là mục tiêu)
        const targets = snaps.filter((t) => t.id !== bot.id && t.team !== bot.team);
        const out = thinkBot(bot.snapshot(), { ...base, targets, goal: this.botGoal(bot) }, bot.brain);
        if (out.fire) g.projectiles.fireBroadside(bot, out.fire);
        if (out.boost) bot.activateBoost();
        bot.update(dt, out, elapsed);
        g.updateResupply(bot, out.reload, dt);
        this.collideLocal(bot);
      }
      // Pháo đài cũng do chủ phòng điều khiển
      g.islands.update(dt, alive, g.projectiles, g.effects);
    }

    for (const s of ships) {
      if (s.remote) s.update(dt, NO_INPUT, elapsed);
      if (s.sunk) {
        if (s.sinkTime < 5) g.effects.burning(s.position, 1 - s.sinkTime / 5);
        if (s.removed) s.root.visible = false;
      }
    }

    g.projectiles.update(dt, ships);

    for (const f of this.flags) f.update(dt, elapsed); // server lo hết hạn cờ rơi

    // Rương: chạm vào thì xin server xác nhận
    for (const l of this.loots.values()) {
      l.update(dt, elapsed);
      if (me.sunk || this.pickupPending.has(l.id)) continue;
      if (Math.hypot(l.position.x - me.position.x, l.position.z - me.position.z) < me.radius * 0.6 + LOOT.pickupRadius) {
        this.pickupPending.add(l.id);
        this.net.emit('pickup', { lootId: l.id });
        setTimeout(() => this.pickupPending.delete(l.id), 1500);
      }
    }

    // Gửi trạng thái 20 lần/giây
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / NET.tickRate) {
      this.sendAcc = 0;
      const r = (v) => Math.round(v * 100) / 100;
      if (!me.sunk) this.net.emitVolatile('state', [r(me.position.x), r(me.position.z), r(me.heading), r(me.speed)]);
      if (this.isHost) {
        const bots = ships.filter((s) => s.kind === 'bot' && !s.remote && !s.sunk);
        if (bots.length) this.net.emitVolatile('bots:state', bots.map((b) => [b.netId, r(b.position.x), r(b.position.z), r(b.heading), r(b.speed)]));
      }
    }

    // Giao diện
    g.sound.setListener(me.position.x, me.position.z);
    const depot = !me.sunk && g.depotAt(me.position);
    g.hud.update(dt, { player: me, stats: this.stats, info: { scores: { blue: 0, red: 0 }, status: [] }, depot: !!depot, respawnIn: 0 });
    g.hud.syncLabels(ships);
    g.hud.updateFloaters(dt);
    g.wind.clockOffset = this.net.clockOffset;
    g.onlineHud.update({
      ping: this.net.ping,
      roomId: this.roomId,
      isPrivate: this.isPrivate,
      online: this.online,
      isHost: this.isHost,
      board: this.board,
      myId: this.myId,
      canRespawn: this.deathInfo && performance.now() - this.deathInfo.at > NET.minRespawnDelay * 1000,
      mode: this.mode,
      modeName: MODES[this.mode]?.name ?? 'Tự do',
      target: this.target,
      scores: this.scores,
      myTeam: this.isTeam ? this.me.team : null,
      flagStatus: ['blue', 'red'].map((team) => {
        const fl = this.flags.filter((f) => f.team === team);
        const lost = fl.filter((f) => f.state !== 'home').length;
        return { team, lost, total: fl.length };
      }),
      resetIn: this.matchEnd ? Math.max(0, Math.ceil((this.matchEnd.until - performance.now()) / 1000)) : 0,
    });
    g.minimap.setEntities({
      ship: me,
      ships,
      loots: [...this.loots.values()],
      strongholds: this.isTeam ? g.strongholds : [],
      depots: g.depots,
      flags: this.flags,
    });
    g.minimap.update(dt);
  }

  dispose() {
    for (const [ev, fn] of this.handlers) this.net.off(ev, fn);
    this.handlers = [];
    for (const s of this.ships.values()) s.dispose(this.game.scene);
    this.ships.clear();
    for (const l of this.loots.values()) l.dispose();
    this.loots.clear();
    for (const f of this.flags) f.dispose();
    this.flags = [];
    this.game.onlineHud.hideMatchEnd();
    const p = this.game.projectiles;
    p.canFire = p.onLaunch = null;
    this.net.leaveRoom();
  }
}
