import * as THREE from 'three';
import { Ship } from './entities/ship.js';
import { Loot } from './entities/loot.js';
import { thinkBot, createBotMemory } from './ai/botBrain.js';
import { SHIP_TYPES, getShipType } from './config/ships.js';
import {
  WORLD,
  LOOT,
  PIRATE_NAMES,
  TEAMS,
  PLAYER_TEAM,
  STRONGHOLDS,
  AMMO_DEPOTS,
  AMMO,
  RAM,
  RESPAWN,
  MODES,
  UPGRADES,
  BUFFS,
  NET,
} from './config/game.js';
import { Wind } from './world/wind.js';
import { FiringArc } from './ui/firingArc.js';
import { ActionBar } from './ui/actionBar.js';
import { Career } from './ui/career.js';
import { TouchControls, IS_TOUCH } from './ui/touchControls.js';
import { Stronghold, AmmoDepot } from './world/structures.js';
import { TeamDeathmatch } from './modes/teamDeathmatch.js';
import { CaptureFlag } from './modes/captureFlag.js';
import { Menu } from './ui/menu.js';
import { Hud } from './ui/hud.js';
import { OnlineHud } from './ui/onlineHud.js';
import { Scoreboard } from './ui/scoreboard.js';
import { Network } from './net/network.js';
import { OnlineSession } from './online/session.js';
import { Islands, DEFAULT_MAP_SEED } from './islands.js';

const NO_INPUT = { forward: false, backward: false, left: false, right: false };
const END_DELAY = 2.5;
const MODE_CLASSES = { tdm: TeamDeathmatch, ctf: CaptureFlag };

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Điều phối trận đấu theo đội: menu (xem trước tàu) -> trận -> tạm dừng / tổng kết.
 * Trạng thái: 'menu' | 'playing' | 'paused' | 'over'
 * Luật thắng thua nằm trong module chế độ chơi (modes/*.js).
 */
export class Game {
  constructor({ scene, camera, ocean, effects, islands, sound, rig, minimap, projectiles, shipTemplates, lootTemplates, structureModels, keys }) {
    Object.assign(this, { scene, camera, ocean, effects, islands, sound, rig, minimap, projectiles, shipTemplates, lootTemplates, structureModels, keys });
    this.state = 'menu';
    this.ships = [];
    this.bots = [];
    this.loots = [];
    this.player = null;
    this.preview = null;
    this.mode = null;
    this.settings = null;
    this.stats = null;
    this.endTimer = 0;
    this.playerReloadRequest = false;
    this.net = new Network();
    this.online = null; // OnlineSession khi đang ở phòng online
    this.onlineMenuOpen = false;

    // Công trình cố định trên bản đồ
    this.strongholds = STRONGHOLDS.map((d) => new Stronghold(scene, structureModels, d));
    this.depots = AMMO_DEPOTS.map((d) => new AmmoDepot(scene, structureModels, d));
    this.obstacles = {
      ...islands.obstacleData(),
      depots: this.depots.map((d) => ({ x: d.x, z: d.z, r: d.zoneRadius })),
    };

    this.minimapEl = document.getElementById('minimap');
    this.helpEl = document.getElementById('help');

    this.menu = new Menu({
      onSelectShip: (id) => this.setPreview(id),
      onStart: (settings) => this.start(settings),
      onOnline: (opts) => this.startOnline(opts),
      onCancel: () => this.net.cancel(),
      onWarmup: () => this.net.warmup(),
    });
    this.hud = new Hud({
      camera,
      muted: sound.muted,
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onToggleSound: () => {
        sound.unlock();
        return sound.toggleMuted();
      },
      onRestart: () => this.start(this.settings),
      onMenu: () => this.enterMenu(),
    });
    this.scoreboard = new Scoreboard();
    this.wind = new Wind(scene, ocean);
    this.firingArc = new FiringArc(scene);
    this.career = new Career();
    this.actionBar = new ActionBar({ onUpgrade: (i) => this.buyUpgrade(i), onBoost: () => this.useBoost() });
    this.touch = IS_TOUCH
      ? new TouchControls({
          keys,
          onFire: (side) => this.fire(side),
          onReload: () => (this.playerReloadRequest = true),
          onBoost: () => this.useBoost(),
        })
      : null;
    if (IS_TOUCH) document.body.classList.add('touch');
    this.onlineHud = new OnlineHud({
      onRespawn: () => this.online?.respawnRequest(),
      onLeave: () => this.leaveOnline(),
      toast: (text, tone) => this.hud.toast(text, tone),
    });

    projectiles.onHit = (target, dmg, attacker, point, ball) => this.damageShip(target, dmg, attacker, point, ball);
    projectiles.onBroadside = (ship) => {
      if (ship.isPlayer) this.rig.addShake(0.25);
    };
    projectiles.onOutOfAmmo = (ship) => {
      if (ship.isPlayer) this.hud.toast('Hết đạn! Tới tháp tiếp đạn và bấm R', 'warn');
    };
    rig.onSeaClick = (point) => {
      const me = this.controlledShip;
      if (me) this.projectiles.fireBroadside(me, me.sideOf(point));
    };

    this.enterMenu();
  }

  // ---------------------------------------------------------------- trạng thái
  /** Giữ Tab: hiện bảng xếp hạng (chỉ trong trận). */
  setScoreboard(visible) {
    if (visible && (this.state === 'playing' || this.state === 'paused' || this.state === 'over' || this.state === 'online')) {
      this.scoreboard.show();
      this.scoreboard.update(this.scoreboardData());
    } else this.scoreboard.hide();
  }

  scoreboardData() {
    if (this.online) return this.online.scoreboardData();
    if (!this.mode || !this.player) return null;
    const info = this.mode.hudInfo();
    return {
      title: info.mode,
      sub: `Chơi đơn · ${this.settings.teamSize} tàu mỗi đội`,
      teamMode: true,
      scores: info.scores,
      target: info.target,
      unit: info.unit,
      rows: this.ships.map((s) => ({
        name: s.name,
        team: s.team,
        kills: s.kills,
        deaths: s.deaths,
        gold: s.isPlayer ? this.stats.gold : null,
        isMe: s.isPlayer,
        isBot: !s.isPlayer,
        alive: !s.sunk,
        carrying: !!s.carryingFlag,
      })),
    };
  }

  /** Hiện / ẩn các phần UI chỉ dùng trong trận. */
  setMatchUi(inMatch) {
    this.actionBar.setVisible(inMatch);
    this.touch?.setVisible(inMatch);
    this.career.setVisible(!inMatch);
    if (!inMatch) this.firingArc.hide();
  }

  enterMenu() {
    this.scoreboard?.hide();
    this.setMatchUi(false);
    if (this.online) {
      this.online.dispose();
      this.online = null;
    }
    this.onlineMenuOpen = false;
    this.onlineHud.setVisible(false);
    this.state = 'menu';
    this.clearMatch();
    this.setMapSeed(DEFAULT_MAP_SEED);
    this.hud.setVisible(false);
    this.hud.showPause(false);
    this.hud.hideSummary();
    this.minimapEl.hidden = true;
    this.helpEl.hidden = true;
    if (this.minimap.expanded) this.minimap.toggle();
    this.rig.setMode('orbit');
    this.menu.show();
  }

  setPreview(id) {
    if (this.state !== 'menu') return;
    if (this.preview) this.preview.dispose(this.scene);
    const type = getShipType(id);
    this.preview = new Ship({ type, template: this.shipTemplates[type.id], ocean: this.ocean, name: 'preview' });
    this.preview.setPose(0, 0, Math.PI * 0.8);
    this.scene.add(this.preview.root);
    this.rig.setShip(this.preview);
  }

  /** settings: { captain, mode: 'tdm'|'ctf', target, teamSize, shipId } */
  start(settings) {
    this.settings = settings;
    this.sound.unlock();
    this.clearMatch();
    this.menu.hide();
    this.hud.hideSummary();
    this.hud.showPause(false);

    const type = getShipType(settings.shipId);
    this.player = new Ship({
      type,
      template: this.shipTemplates[type.id],
      ocean: this.ocean,
      name: settings.captain,
      team: PLAYER_TEAM,
      isPlayer: true,
    });
    this.scene.add(this.player.root);
    this.ships.push(this.player);
    this.placeAtSpawn(this.player);

    // Đồng đội (teamSize - 1) + đối thủ (teamSize)
    const names = shuffle(PIRATE_NAMES);
    let n = 0;
    for (const team of ['blue', 'red']) {
      const count = team === PLAYER_TEAM ? settings.teamSize - 1 : settings.teamSize;
      for (let i = 0; i < count; i++) this.spawnBot(team, names[n++ % names.length]);
    }

    const ModeClass = MODE_CLASSES[settings.mode] || TeamDeathmatch;
    this.mode = new ModeClass(this, settings.target);
    this.mode.setup();

    this.stats = { kills: 0, deaths: 0, gold: 0, damage: 0, flags: 0, time: 0 };
    this.endTimer = 0;
    this.state = 'playing';
    this.hud.setVisible(true);
    this.hud.setMode(this.mode, settings);
    this.setMatchUi(true);
    this.minimapEl.hidden = false;
    this.helpEl.hidden = false;
    this.rig.setShip(this.player);
    this.rig.setMode('follow');
    this.announce(`${MODES[settings.mode].name} · Mục tiêu ${settings.target} ${this.mode.hudInfo().unit}`, PLAYER_TEAM);
  }

  spawnBot(team, name) {
    const type = SHIP_TYPES[Math.floor(Math.random() * SHIP_TYPES.length)];
    const bot = new Ship({ type, template: this.shipTemplates[type.id], ocean: this.ocean, name, team });
    bot.brain = createBotMemory();
    this.scene.add(bot.root);
    this.ships.push(bot);
    this.bots.push(bot);
    this.placeAtSpawn(bot);
    bot.reload.left = Math.random() * type.reload;
    bot.reload.right = Math.random() * type.reload;
    return bot;
  }

  /** Đặt tàu ở vùng nước trống quanh một cứ điểm của đội, mũi hướng vào giữa bản đồ. */
  placeAtSpawn(ship) {
    const bases = this.strongholds.filter((h) => h.team === ship.team);
    for (let tries = 0; tries < 60; tries++) {
      const base = bases[Math.floor(Math.random() * bases.length)];
      const a = Math.random() * Math.PI * 2;
      const d = 28 + Math.random() * 30;
      const x = base.x + Math.cos(a) * d;
      const z = base.z + Math.sin(a) * d;
      if (!this.islands.isOpenWater(x, z, 10, false)) continue;
      const crowded = this.ships.some((s) => s !== ship && !s.sunk && Math.hypot(s.position.x - x, s.position.z - z) < 14);
      if (crowded && tries < 50) continue;
      ship.respawn(x, z, Math.atan2(-x * 0.3, -z));
      return;
    }
    ship.respawn(bases[0].x, bases[0].z + (ship.team === 'blue' ? -30 : 30), ship.team === 'blue' ? Math.PI : 0);
  }

  /** Tàu người chơi đang điều khiển được (để bắn bằng Space / click). */
  get controlledShip() {
    if (this.state === 'playing' && this.player && !this.player.sunk) return this.player;
    if (this.state === 'online' && this.online && !this.onlineMenuOpen && !this.online.me.sunk) return this.online.me;
    return null;
  }

  fire(side) {
    const me = this.controlledShip;
    if (me) this.projectiles.fireBroadside(me, side);
  }

  /** Mua nâng cấp nhánh index (0–3) bằng vàng. Online thì gửi server xác nhận. */
  buyUpgrade(index) {
    const b = UPGRADES.branches[index];
    if (!b) return;
    if (this.state === 'online') return this.online?.buyUpgrade(index);
    if (this.state !== 'playing' || !this.player) return;
    const ship = this.player;
    const lvl = ship.upgrades[b.id];
    if (lvl >= UPGRADES.maxLevel) return this.upgradeDenied(index, `${b.name} đã đạt cấp tối đa`);
    const cost = UPGRADES.costs[lvl];
    if (this.stats.gold < cost) return this.upgradeDenied(index, `Cần ${cost} vàng để nâng ${b.short}`);
    this.stats.gold -= cost;
    ship.upgrades[b.id] = lvl + 1;
    ship.applyUpgrades();
    if (b.id === 'hull' && !ship.sunk) ship.heal(UPGRADES.hullHp);
    this.onUpgraded(ship, index);
  }

  upgradeDenied(index, reason) {
    this.sound.deny();
    this.actionBar.flash(index, false);
    this.hud.toast(reason, 'warn');
  }

  /** Hiệu ứng khi nâng cấp thành công (dùng cho cả online). */
  onUpgraded(ship, index) {
    const b = UPGRADES.branches[index];
    this.sound.upgrade();
    this.actionBar.flash(index, true);
    this.effects.burst(ship.position.clone(), 0xffd34d);
    this.hud.toast(`${b.name} · cấp ${ship.upgrades[b.id]}: ${b.effect}`, 'warn');
  }

  useBoost() {
    const ship = this.controlledShip;
    if (!ship) return;
    if (ship.activateBoost()) {
      this.sound.whoosh();
      this.rig.addShake(0.2);
    } else this.sound.deny();
  }

  /** Mỗi khung hình (chơi đơn + online): gió, vệt bọt lướt sóng, cháy, vùng ngắm, thanh nâng cấp. */
  updateExtras(dt, elapsed, ships, me, gold) {
    this.wind.update(dt, this.focus, elapsed);
    this.minimap.windAngle = this.wind.angle;
    for (const s of ships) {
      if (s.sunk) continue;
      if (!s.remote) s.windFactor = this.wind.factorFor(s.heading);
      // Vệt bọt nước lớn khi lướt sóng (tàu remote: nhận ra qua tốc độ vượt mức thường)
      if (s.boostTime > 0 || (s.remote && s.speed > s.maxSpeed * 1.3)) this.effects.wake(s);
      if (s.burnVisual > 0 || s.burn) this.effects.burning(s.position, 0.5);
    }
    // Vùng ngắm bắn theo mạn có trỏ chuột
    const ctrl = this.controlledShip;
    const mouse = !IS_TOUCH && ctrl ? this.rig.mouseSeaPoint() : null;
    if (ctrl && mouse) {
      const side = ctrl.sideOf(mouse);
      this.firingArc.update(ctrl, side, ctrl.reload[side] <= 0 && ctrl.ammo > 0, this.ocean);
    } else this.firingArc.hide();
    if (me) this.actionBar.update(me, gold);
  }

  // ---------------------------------------------------------------- online
  /** Dựng lại đảo theo mapSeed của phòng để mọi người thấy bản đồ giống hệt nhau. */
  setMapSeed(seed) {
    this.wind.setSeed(seed);
    if (this.islands.seed === seed) return;
    this.islands.dispose();
    this.islands = new Islands(this.scene, this.structureModels, { seed });
    this.projectiles.islands = this.islands;
    this.minimap.islands = this.islands;
    this.obstacles = {
      ...this.islands.obstacleData(),
      depots: this.depots.map((d) => ({ x: d.x, z: d.z, r: d.zoneRadius })),
    };
  }

  /** opts: { type: 'public'|'create'|'join', code?, bots?, name, shipId } */
  async startOnline(opts) {
    this.sound.unlock();
    const label = opts.type === 'join' ? `Đang vào phòng ${opts.code}…` : opts.type === 'create' ? 'Đang tạo phòng riêng…' : 'Đang tìm phòng chung…';
    this.menu.setBusy(true, label);
    let room;
    try {
      room = await this.net.joinRoom(opts, (sec) => this.menu.showConnecting(sec, label));
    } catch (err) {
      this.menu.setBusy(false);
      this.menu.setStatus(err.message, 'error');
      return;
    }
    this.menu.setBusy(false);
    this.menu.setStatus('');
    this.clearMatch();
    this.setMapSeed(room.mapSeed);
    this.menu.hide();
    this.online = new OnlineSession(this, this.net, room);
    this.player = null;
    this.state = 'online';
    this.onlineMenuOpen = false;
    this.hud.setVisible(true);
    this.hud.right.hidden = true; // bảng tỉ số đội không dùng trong chế độ tự do
    this.onlineHud.setVisible(true);
    this.setMatchUi(true);
    this.wind.clockOffset = this.net.clockOffset;
    this.minimapEl.hidden = false;
    this.helpEl.hidden = false;
    this.rig.setShip(this.online.me);
    this.rig.setMode('follow');
    this.hud.toast(`Đã vào ${room.isPrivate ? 'phòng riêng' : 'phòng chung'} ${room.roomId}`, 'blue');
  }

  leaveOnline(message = '') {
    if (!this.online) return;
    this.enterMenu();
    if (message) this.menu.setStatus(message, 'error');
  }

  pause() {
    if (this.state === 'online') {
      // Trận online không dừng được: chỉ mở bảng menu, trận vẫn tiếp diễn
      this.onlineMenuOpen = true;
      this.hud.showPause(true, true);
      return;
    }
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showPause(true);
  }

  resume() {
    if (this.state === 'online') {
      this.onlineMenuOpen = false;
      this.hud.showPause(false);
      return;
    }
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.showPause(false);
  }

  togglePause() {
    if (this.state === 'online') return this.onlineMenuOpen ? this.resume() : this.pause();
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  clearMatch() {
    this.mode?.dispose();
    this.mode = null;
    for (const s of this.ships) s.dispose(this.scene);
    this.ships = [];
    this.bots = [];
    this.player = null;
    if (this.preview) {
      this.preview.dispose(this.scene);
      this.preview = null;
    }
    for (const l of this.loots) l.dispose();
    this.loots = [];
    this.projectiles.clear();
    this.effects.clear();
    this.hud.clearWorldUi();
  }

  announce(text, team = null) {
    this.hud.toast(text, team);
  }

  // ---------------------------------------------------------------- chiến đấu
  /** attacker: Ship | null (null = đảo, pháo đài) */
  damageShip(target, dmg, attacker, point, ball = null) {
    if (target.sunk) return;
    const killed = target.damage(dmg, attacker);
    if (ball?.fire && !killed) {
      const f = BUFFS.kinds.fire;
      target.burn = { time: f.burnTime, tick: 1, by: attacker };
    }
    this.hud.floatText(point, `-${dmg}`, target.isPlayer ? 'dmg-self' : target.team === PLAYER_TEAM ? 'dmg-ally' : 'dmg');
    if (attacker?.isPlayer && this.stats) this.stats.damage += dmg;
    if (target.isPlayer) {
      this.rig.addShake(0.6);
      this.hud.flashHit();
    }
    if (killed) this.handleSunk(target);
  }

  handleSunk(ship) {
    const pos = ship.position.clone();
    this.effects.shipExplosion(pos);
    this.sound.explode(pos);
    ship.deaths++;
    ship.respawnTimer = ship.isPlayer ? RESPAWN.playerDelay : RESPAWN.botDelay;
    ship.resupply = 0;
    const attacker = ship.lastAttacker;
    if (attacker && attacker.team !== ship.team) attacker.kills++;
    this.mode?.onShipSunk(ship, attacker);

    ship.burn = null;
    if (ship.isPlayer) {
      this.stats.deaths++;
      const lost = this.stats.gold - Math.floor(this.stats.gold * UPGRADES.keepGoldOnDeath);
      this.stats.gold -= lost;
      if (lost > 0) this.hud.toast(`Tàu chìm: mất ${lost} vàng (giữ lại 50%, nâng cấp vẫn còn)`, 'warn');
    }
    if (attacker?.isPlayer) {
      this.stats.kills++;
      this.stats.gold += NET.killGold;
      this.career.add('kills');
      this.career.add('gold', NET.killGold);
      this.hud.floatText(pos.clone().add(new THREE.Vector3(0, 6, 0)), `Hạ gục! +${NET.killGold} vàng`, 'kill');
    }
    const by = attacker ? attacker.name : 'đá ngầm / pháo đài';
    this.hud.killFeed(by, attacker?.team, ship.name, ship.team);
    if (!ship.isPlayer) ship.lootPending = true;
  }

  dropLoot(ship) {
    const kind = Math.random() < LOOT.kinds.chest.chance ? 'chest' : 'barrel';
    this.loots.push(
      new Loot({ scene: this.scene, template: this.lootTemplates[kind], kind, x: ship.position.x, z: ship.position.z, ocean: this.ocean }),
    );
    if (Math.random() < BUFFS.dropChance) {
      const buff = Math.random() < 0.5 ? 'fire' : 'rapid';
      const a = Math.random() * Math.PI * 2;
      this.loots.push(
        new Loot({
          scene: this.scene,
          template: this.structureModels.crate,
          kind: buff,
          x: ship.position.x + Math.cos(a) * 7,
          z: ship.position.z + Math.sin(a) * 7,
          ocean: this.ocean,
        }),
      );
    }
  }

  /** Nhặt rương / thùng buff (chơi đơn). */
  collectLoot(ship, l) {
    if (l.buff) {
      ship.applyBuff(l.buff);
      const b = BUFFS.kinds[l.buff];
      this.hud.floatText(l.position, `${b.name}!`, 'gold');
      this.hud.toast(`${b.name}: hiệu lực ${BUFFS.duration} giây`, 'warn');
      this.effects.burst(l.position.clone(), b.color);
      this.sound.powerup();
      return;
    }
    const healed = ship.heal(l.heal);
    this.stats.gold += l.gold;
    this.career.add('gold', l.gold);
    this.hud.floatText(l.position, `+${l.gold} vàng`, 'gold');
    if (healed > 0) this.hud.floatText(l.position.clone().add(new THREE.Vector3(0, 2, 0)), `+${Math.round(healed)} HP`, 'heal');
    this.effects.sparkle(l.position);
    this.sound.coin();
  }

  /** Va chạm: đảo (đâm vào đất liền mất máu), công trình, tàu với tàu, rìa bản đồ. */
  collide() {
    const alive = this.ships.filter((s) => !s.sunk);
    for (const s of alive) {
      const speedBefore = Math.abs(s.speed);
      if (this.islands.collideShip(s)) {
        if (speedBefore > RAM.minSpeed && s.groundCooldown <= 0) {
          s.groundCooldown = RAM.cooldown;
          s.speed *= -0.25; // dội ngược lại
          const p = s.position.clone().add(new THREE.Vector3(0, 1, 0));
          this.effects.impact(p);
          this.sound.hit(p);
          if (s.isPlayer) this.hud.toast(`Đâm vào đất liền! -${RAM.damage} HP`, 'warn');
          this.damageShip(s, RAM.damage, null, p);
        }
      }
      for (const st of this.strongholds) st.collide(s);
      for (const d of this.depots) d.collide(s);
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const minD = (a.radius + b.radius) * 0.62;
        if (d >= minD) continue;
        const push = (minD - d) / 2;
        a.position.x -= (dx / d) * push;
        a.position.z -= (dz / d) * push;
        b.position.x += (dx / d) * push;
        b.position.z += (dz / d) * push;
        a.speed *= 0.92;
        b.speed *= 0.92;
      }
    }
    for (const s of alive) {
      const r = Math.hypot(s.position.x, s.position.z);
      if (r > WORLD.hardLimit) {
        s.position.x *= WORLD.hardLimit / r;
        s.position.z *= WORLD.hardLimit / r;
        s.speed *= 0.9;
      }
    }
  }

  depotAt(pos) {
    return this.depots.find((d) => d.contains(pos)) || null;
  }

  /** Nạp đạn ở tháp: bắt đầu khi yêu cầu (phím R / bot), giữ trong vùng đủ lâu là đầy. */
  updateResupply(ship, requested, dt) {
    const depot = !ship.sunk && this.depotAt(ship.position);
    if (!depot) {
      if (ship.resupply > 0 && ship.isPlayer) this.hud.toast('Rời tháp, huỷ nạp đạn', 'warn');
      ship.resupply = 0;
      return;
    }
    if (ship.resupply === 0) {
      if (!requested) return;
      if (ship.ammo >= ship.maxAmmo) {
        if (ship.isPlayer) this.hud.toast('Đạn đã đầy', null);
        return;
      }
      ship.resupply = 0.0001;
    }
    ship.resupply += dt;
    if (ship.resupply >= ship.resupplyTime) {
      ship.resupply = 0;
      ship.ammo = ship.maxAmmo;
      if (ship.isPlayer) {
        this.hud.toast(`Đã nạp đầy ${ship.maxAmmo} lượt bắn`, PLAYER_TEAM);
        this.sound.coin();
        this.effects.sparkle(ship.position);
      }
    }
  }

  // ---------------------------------------------------------------- vòng lặp
  get focus() {
    return (this.online?.me || this.player || this.preview)?.position ?? new THREE.Vector3();
  }

  update(dt, elapsed) {
    if (this.scoreboard.visible) this.scoreboard.update(this.scoreboardData());
    if (this.state === 'paused') return;
    for (const st of [...this.strongholds, ...this.depots]) st.update(elapsed);

    if (this.state === 'online') {
      this.online.update(dt, elapsed, !this.onlineMenuOpen);
      this.updateExtras(dt, elapsed, this.online.shipList, this.online.me, this.online.stats.gold);
      this.effects.update(dt);
      this.rig.update(dt);
      return;
    }

    if (this.state === 'menu') {
      this.rig.leftInset = this.menu.panelWidth;
      this.wind.update(dt, this.focus, elapsed);
      if (this.preview) this.preview.update(dt, NO_INPUT, elapsed);
      this.effects.update(dt);
      this.rig.update(dt);
      return;
    }

    const player = this.player;
    const keys = this.keys;
    const input =
      this.state === 'playing'
        ? {
            forward: keys.KeyW || keys.ArrowUp,
            backward: keys.KeyS || keys.ArrowDown,
            left: keys.KeyA || keys.ArrowLeft,
            right: keys.KeyD || keys.ArrowRight,
          }
        : NO_INPUT;
    player.update(dt, input, elapsed);
    this.updateResupply(player, this.playerReloadRequest && this.state === 'playing', dt);
    this.playerReloadRequest = false;

    // --- Bot suy nghĩ & điều khiển ---
    const snaps = this.ships.filter((s) => !s.sunk).map((s) => s.snapshot());
    const base = {
      time: elapsed,
      dt,
      islands: this.obstacles.islands,
      forts: this.obstacles.forts,
      depots: this.obstacles.depots,
      worldRadius: WORLD.radius,
    };
    for (const bot of this.bots) {
      if (bot.sunk) {
        bot.update(dt, NO_INPUT, elapsed);
        continue;
      }
      const world = {
        ...base,
        targets: snaps.filter((t) => t.team !== bot.team),
        goal: this.mode.botGoal(bot),
      };
      const out = thinkBot(bot.snapshot(), world, bot.brain);
      if (out.fire) this.projectiles.fireBroadside(bot, out.fire);
      if (out.boost) bot.activateBoost();
      bot.update(dt, out, elapsed);
      this.updateResupply(bot, out.reload, dt);
    }

    // --- Va chạm, pháo đài, đạn ---
    this.collide();
    this.islands.update(dt, this.ships.filter((s) => !s.sunk), this.projectiles, this.effects);
    this.projectiles.update(dt, this.ships);
    this.mode.update(dt, elapsed);

    // --- Đạn lửa: cháy 4 HP/giây trong 4 giây ---
    for (const s of this.ships) {
      if (!s.burn || s.sunk) continue;
      s.burn.time -= dt;
      s.burn.tick -= dt;
      if (s.burn.tick <= 0) {
        s.burn.tick += 1;
        this.damageShip(s, BUFFS.kinds.fire.burnDps, s.burn.by, s.position.clone().add(new THREE.Vector3(0, 3, 0)));
      }
      if (s.burn && s.burn.time <= 0) s.burn = null;
    }

    // --- Tàu đang chìm: lửa khói, rớt kho báu, hồi sinh ---
    for (const s of this.ships) {
      if (!s.sunk) continue;
      if (s.sinkTime < 5) this.effects.burning(s.position, 1 - s.sinkTime / 5);
      if (s.lootPending && s.sinkTime > 0.8) {
        s.lootPending = false;
        this.dropLoot(s);
      }
      s.respawnTimer -= dt;
      if (s.respawnTimer <= 0 && this.state === 'playing') {
        this.placeAtSpawn(s);
        if (s.isPlayer) this.hud.toast('Đã hồi sinh tại cứ điểm', PLAYER_TEAM);
      }
    }

    // --- Kho báu ---
    for (let i = this.loots.length - 1; i >= 0; i--) {
      const l = this.loots[i];
      l.update(dt, elapsed);
      const d = Math.hypot(l.position.x - player.position.x, l.position.z - player.position.z);
      if (!player.sunk && d < player.radius * 0.6 + LOOT.pickupRadius) {
        this.collectLoot(player, l);
        l.dispose();
        this.loots.splice(i, 1);
      } else if (l.expired) {
        l.dispose();
        this.loots.splice(i, 1);
      }
    }

    // --- Thắng / thua ---
    if (this.state === 'playing') {
      this.stats.time += dt;
      const winner = this.mode.winner();
      if (winner) {
        if (this.endTimer === 0) {
          this.endTimer = END_DELAY;
          this.announce(`Đội ${TEAMS[winner].name} chiến thắng!`, winner);
        }
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.finish(winner);
      }
    }

    this.updateExtras(dt, elapsed, this.ships, player, this.stats.gold);
    this.effects.update(dt);
    this.rig.update(dt);
    this.sound.setListener(player.position.x, player.position.z);
    const depot = !player.sunk && this.depotAt(player.position);
    this.hud.update(dt, {
      player,
      stats: this.stats,
      info: this.mode.hudInfo(),
      depot: !!depot,
      respawnIn: player.sunk ? Math.max(0, player.respawnTimer) : 0,
    });
    this.hud.syncLabels(this.ships);
    this.hud.updateFloaters(dt);
    this.minimap.setEntities({
      ship: player,
      ships: this.ships,
      loots: this.loots,
      strongholds: this.strongholds,
      depots: this.depots,
      flags: this.mode.flags || [],
    });
    this.minimap.update(dt);
  }

  finish(winner) {
    this.state = 'over';
    this.career.add('matches');
    if (winner === PLAYER_TEAM) this.career.add('wins');
    this.firingArc.hide();
    const info = this.mode.hudInfo();
    this.hud.showSummary({
      victory: winner === PLAYER_TEAM,
      mode: info.mode,
      unit: info.unit,
      scores: info.scores,
      target: info.target,
      captain: this.settings.captain,
      shipName: this.player.type.name,
      ...this.stats,
      showFlags: this.mode.id === 'ctf',
    });
  }
}
