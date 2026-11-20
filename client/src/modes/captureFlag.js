import { MODES, TEAMS } from '../config/game.js';
import { Flag } from '../entities/flag.js';

const PICKUP_DROPPED = 9; // bán kính chạm cờ rơi trên biển

const nearest = (list, pos) =>
  list.reduce(
    (best, o) => {
      const d = Math.hypot(o.x - pos.x, o.z - pos.z);
      return d < best.d ? { o, d } : best;
    },
    { o: null, d: Infinity },
  ).o;

/** Gán vai cho bot của một đội: xen kẽ tấn công / phòng thủ, mỗi bot phòng thủ giữ một cứ điểm. */
export function assignCtfRoles(bots, strongholds) {
  const counter = {};
  for (const b of bots) {
    const i = (counter[b.team] = (counter[b.team] ?? -1) + 1);
    b.brain.role = i % 2 === 0 ? 'attack' : 'defend';
    const own = strongholds.filter((h) => h.team === b.team);
    b.brain.post = own[i % own.length];
  }
}

/**
 * Mục tiêu di chuyển cho bot theo vai (dùng cho cả chơi đơn và online).
 * ctx: { ships, strongholds, flags } — flags có team, state ('home'|'carried'|'dropped'), position.
 */
export function ctfBotGoal(bot, { ships, strongholds, flags }) {
  const p = bot.position;
  if (bot.carryingFlag) {
    const home = nearest(strongholds.filter((h) => h.team === bot.team), p);
    return { x: home.x, z: home.z, urgent: true };
  }
  const ownLost = flags.filter((f) => f.team === bot.team && f.state !== 'home');
  if (ownLost.length && (bot.brain.role === 'defend' || ownLost.some((f) => f.state === 'dropped'))) {
    const f = nearest(ownLost.map((fl) => ({ x: fl.position.x, z: fl.position.z, fl })), p);
    return { x: f.x, z: f.z, urgent: f.fl.state === 'dropped' };
  }
  if (bot.brain.role === 'attack') {
    const enemyFlags = flags.filter((f) => f.team !== bot.team && f.state !== 'carried');
    if (enemyFlags.length) {
      const f = nearest(enemyFlags.map((fl) => ({ x: fl.position.x, z: fl.position.z })), p);
      return { x: f.x, z: f.z };
    }
    const carrier = ships.find((s) => s.team === bot.team && s.carryingFlag && !s.sunk);
    if (carrier) return { x: carrier.position.x, z: carrier.position.z, loiter: true, radius: 30 };
  }
  const post = bot.brain.post || nearest(strongholds.filter((h) => h.team === bot.team), p);
  return { x: post.x, z: post.z, loiter: true, radius: 45 };
}

/**
 * Cướp cờ: mỗi đội có 2 cứ điểm, mỗi cứ điểm cắm 1 lá cờ.
 * Lái tàu vào vùng cứ điểm địch để cướp cờ, mang về bất kỳ cứ điểm nào của đội mình để ghi điểm.
 * Tàu giữ cờ bị chìm -> cờ rơi tại chỗ: đội chủ chạm vào để trả về, đội địch chạm vào để cướp tiếp;
 * để lâu cờ tự về cứ điểm.
 */
export class CaptureFlag {
  constructor(game, target) {
    this.game = game;
    this.id = 'ctf';
    this.def = MODES.ctf;
    this.target = target;
    this.scores = { blue: 0, red: 0 };
    this.flags = [];
  }

  setup() {
    const g = this.game;
    this.flags = g.strongholds.map(
      (h) => new Flag({ scene: g.scene, template: g.structureModels['flag-high'], stronghold: h, ocean: g.ocean }),
    );
    assignCtfRoles(g.bots, g.strongholds);
  }

  onShipSunk(victim) {
    const flag = victim.carryingFlag;
    if (flag) {
      flag.drop();
      this.game.announce(`${victim.name} làm rơi cờ ${TEAMS[flag.team].name}`, flag.team);
    }
  }

  update(dt, time) {
    const g = this.game;
    for (const flag of this.flags) {
      if (flag.update(dt, time) === 'expired') {
        flag.returnHome();
        g.announce(`Cờ ${TEAMS[flag.team].name} đã tự về cứ điểm`, flag.team);
      }
    }

    for (const ship of g.ships) {
      if (ship.sunk) continue;
      const p = ship.position;

      // Mang cờ địch về cứ điểm của mình -> ghi điểm
      if (ship.carryingFlag) {
        const home = g.strongholds.find((h) => h.team === ship.team && h.contains(p));
        if (home) {
          const flag = ship.carryingFlag;
          ship.carryingFlag = null;
          flag.returnHome();
          this.scores[ship.team]++;
          if (ship.isPlayer) g.stats.flags++;
          g.announce(`${ship.name} cướp cờ thành công! +1 ${TEAMS[ship.team].name}`, ship.team);
          g.sound.coin();
          g.effects.sparkle(p);
        }
        continue;
      }

      for (const flag of this.flags) {
        if (flag.state === 'carried') continue;
        if (flag.team === ship.team) {
          // Đồng đội chạm cờ rơi -> trả về cứ điểm
          if (flag.state === 'dropped' && Math.hypot(flag.position.x - p.x, flag.position.z - p.z) < PICKUP_DROPPED + ship.radius * 0.5) {
            flag.returnHome();
            g.announce(`${ship.name} đã thu hồi cờ ${TEAMS[flag.team].name}`, flag.team);
          }
          continue;
        }
        const near =
          flag.state === 'home'
            ? flag.stronghold.contains(p)
            : Math.hypot(flag.position.x - p.x, flag.position.z - p.z) < PICKUP_DROPPED + ship.radius * 0.5;
        if (near) {
          flag.pickUp(ship);
          g.announce(`${ship.name} đã cướp cờ ${TEAMS[flag.team].name}!`, ship.team);
          break;
        }
      }
    }
  }

  /** Mục tiêu di chuyển cho bot theo vai. */
  botGoal(bot) {
    return ctfBotGoal(bot, { ships: this.game.ships, strongholds: this.game.strongholds, flags: this.flags });
  }

  winner() {
    if (this.scores.blue >= this.target) return 'blue';
    if (this.scores.red >= this.target) return 'red';
    return null;
  }

  hudInfo() {
    const status = ['blue', 'red'].map((team) => {
      const flags = this.flags.filter((f) => f.team === team);
      const lost = flags.filter((f) => f.state !== 'home').length;
      return { team, text: lost ? `${lost}/${flags.length} cờ bị mất` : 'Cờ an toàn', alert: lost > 0 };
    });
    return { mode: this.def.name, unit: 'cờ', scores: this.scores, target: this.target, status };
  }

  dispose() {
    for (const f of this.flags) f.dispose();
    this.flags = [];
  }
}
