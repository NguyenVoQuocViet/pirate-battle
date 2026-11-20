import { MODES, TEAMS, enemyTeam } from '../config/game.js';

/** Mục tiêu cho bot khi chưa thấy địch: tàu địch gần nhất trên bản đồ, không có thì cứ điểm địch. */
export function tdmBotGoal(bot, { ships, strongholds }) {
  let best = null;
  let bestD = Infinity;
  for (const s of ships) {
    if (s.sunk || s.team === bot.team) continue;
    const d = Math.hypot(s.position.x - bot.position.x, s.position.z - bot.position.z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best) return { x: best.position.x, z: best.position.z };
  const base = strongholds.find((h) => h.team === enemyTeam(bot.team));
  return base ? { x: base.x, z: base.z, loiter: true, radius: 60 } : null;
}

/**
 * Đối đầu đồng đội: đội nào bắn chìm đủ `target` tàu đối phương trước thì thắng.
 * Chỉ tính tàu bị đối phương bắn chìm (chìm vì đâm đảo / pháo đài không tính điểm).
 */
export class TeamDeathmatch {
  constructor(game, target) {
    this.game = game;
    this.id = 'tdm';
    this.def = MODES.tdm;
    this.target = target;
    this.scores = { blue: 0, red: 0 };
  }

  setup() {}

  onShipSunk(victim, attacker) {
    if (attacker && attacker.team && attacker.team !== victim.team) {
      this.scores[attacker.team]++;
    }
  }

  update() {}

  botGoal(bot) {
    return tdmBotGoal(bot, { ships: this.game.ships, strongholds: this.game.strongholds });
  }

  winner() {
    if (this.scores.blue >= this.target) return 'blue';
    if (this.scores.red >= this.target) return 'red';
    return null;
  }

  hudInfo() {
    return {
      mode: this.def.name,
      unit: 'tàu',
      scores: this.scores,
      target: this.target,
      status: [],
    };
  }

  scoreLabel(team) {
    return `${TEAMS[team].name} ${this.scores[team]}`;
  }

  dispose() {}
}
