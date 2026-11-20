/**
 * Hằng số gameplay dùng chung (dữ liệu thuần, server có thể import lại).
 */

export const WORLD = {
  radius: 420, // bán kính vùng có đảo
  hardLimit: 560, // tàu bị đẩy lại nếu ra xa hơn
  playerSpawn: { x: 0, z: 0, heading: Math.PI },
};

/** Số tàu mỗi đội (đã gồm người chơi ở đội Xanh). */
export const TEAM_SIZE_OPTIONS = [3, 5, 8];
export const DEFAULT_TEAM_SIZE = 5;

export const TEAMS = {
  blue: { id: 'blue', name: 'Xanh', color: 0x3d8bfd, css: '#3d8bfd' },
  red: { id: 'red', name: 'Đỏ', color: 0xe5322d, css: '#e5322d' },
};
export const PLAYER_TEAM = 'blue';
export const enemyTeam = (team) => (team === 'blue' ? 'red' : 'blue');

/** Chế độ chơi và mục tiêu mặc định (tuỳ chỉnh được khi tạo phòng). */
export const MODES = {
  tdm: {
    id: 'tdm',
    name: 'Đối đầu đồng đội',
    short: 'Team Deathmatch',
    desc: 'Đội nào bắn chìm đủ số tàu đối phương trước sẽ thắng.',
    targetLabel: 'Số tàu cần hạ',
    defaultTarget: 30,
    min: 5,
    max: 100,
  },
  ctf: {
    id: 'ctf',
    name: 'Cướp cờ',
    short: 'Capture the Flag',
    desc: 'Mỗi đội 2 cứ điểm. Cướp cờ ở cứ điểm địch, mang về cứ điểm mình để ghi điểm.',
    targetLabel: 'Số cờ cần cướp',
    defaultTarget: 10,
    min: 1,
    max: 30,
  },
};
export const DEFAULT_MODE = 'tdm';

/** Cứ điểm mỗi đội (Xanh ở phía nam = cuối màn hình, Đỏ ở phía bắc). Cũng là nơi hồi sinh. */
export const STRONGHOLDS = [
  { id: 'blue-w', team: 'blue', x: -170, z: 350 },
  { id: 'blue-e', team: 'blue', x: 170, z: 350 },
  { id: 'red-w', team: 'red', x: -170, z: -350 },
  { id: 'red-e', team: 'red', x: 170, z: -350 },
];
export const STRONGHOLD = {
  zoneRadius: 20, // vùng chạm để lấy / nộp cờ
  coreRadius: 5, // trụ tháp ở giữa (tàu va vào bị đẩy ra, không mất máu)
  reserve: 95, // không sinh đảo trong bán kính này
};

/** Tháp tiếp đạn: vào vùng và bấm R để nạp. */
export const AMMO_DEPOTS = [
  { id: 'depot-s', x: 0, z: 285 },
  { id: 'depot-n', x: 0, z: -285 },
  { id: 'depot-w', x: -275, z: 15 },
  { id: 'depot-e', x: 275, z: -15 },
  { id: 'depot-c', x: 0, z: 95 },
];
export const AMMO = {
  max: 10, // số lần bắn (mỗi loạt một mạn = 1 lần)
  depotRadius: 18,
  coreRadius: 4.5,
  reserve: 55,
  resupplyTime: 1.5, // giây nạp đầy
};

/** Đâm vào đất liền. */
export const RAM = {
  damage: 50,
  minSpeed: 2, // chạm nhẹ khi gần như đứng yên thì không tính
  cooldown: 2.5,
};

export const RESPAWN = {
  playerDelay: 5,
  botDelay: 6,
};

export const CTF = {
  dropReturnTime: 25, // cờ rơi trên biển tự về cứ điểm sau chừng này giây
  carrierSpeedFactor: 0.85, // giữ cờ thì chạy chậm hơn chút
};

export const COMBAT = {
  gravity: 20,
  muzzleSpeed: 38,
  fortDamage: 10,
  shipCollisionDamage: 0,
};

export const FORT = {
  fortRatio: 0.8, // tỉ lệ đảo có pháo đài
  minDistFromSpawn: 115, // không xây pháo đài quá gần điểm xuất phát
  castleMinRadius: 27, // đảo từ cỡ này trở lên xây thành lớn, nhỏ hơn là tháp canh
  castleRange: 66,
  outpostRange: 54,
  reloadMin: 3.4,
  reloadMax: 5.5,
  spread: 2.4,
};

export const LOOT = {
  heal: 30,
  pickupRadius: 4, // cộng thêm bán kính tàu
  lifetime: 90, // giây trước khi chìm mất
  kinds: {
    chest: { model: 'chest', gold: [70, 130], chance: 0.45, scale: 2.2 },
    barrel: { model: 'barrel', gold: [25, 50], chance: 0.55, scale: 2.0 },
  },
};

export const AI = {
  detectRange: 130, // thấy mục tiêu trong bán kính này thì đuổi
  loseRange: 175, // ra khỏi bán kính này thì bỏ đuổi
  engageRange: 48, // trong khoảng này chuyển sang xoay ngang mạn
  idealRange: 26, // khoảng cách muốn giữ khi đấu pháo
  fireRange: 33, // tầm bắn hiệu quả của đại bác tàu
  fireAngle: 0.24, // sai lệch góc tối đa (rad) giữa mạn tàu và mục tiêu để bắn
  patrolSpeed: 0.65, // tỉ lệ tốc độ tối đa khi tuần tra
  combatSpeed: 0.75,
  thinkJitter: 0.15, // thời gian phản xạ ngẫu nhiên (giây)
};

export const PIRATE_NAMES = [
  'Râu Đen', 'Mắt Chột', 'Móc Sắt', 'Rắn Độc', 'Sói Biển', 'Cá Mập Xám', 'Bão Táp',
  'Tóc Đỏ', 'Chân Gỗ', 'Quạ Đen', 'Lưỡi Dao', 'Sấm Sét', 'Thuyền Trưởng Rum',
  'Bà Chúa Sóng', 'Lão Hải Quỷ', 'Kẻ Câm', 'Răng Vàng', 'Đầu Lâu', 'Gió Bấc', 'Mỏ Neo',
];

/** Nhiều người chơi (dùng chung client + server). */
export const NET = {
  defaultPort: 3001,
  tickRate: 20, // số lần gửi / phát trạng thái mỗi giây
  maxPlayers: 8,
  publicBots: 3, // số bot trong phòng chung
  publicTeamBots: 4, // phòng chung chế độ đội: chia đều 2 bot mỗi đội
  modes: ['ffa', 'tdm', 'ctf'], // ffa = tự do, ai cũng là đối thủ
  resetDelay: 8, // giây giữa hai trận khi một đội thắng
  privateBotOptions: [0, 2, 4],
  killGold: 50, // vàng thưởng khi hạ một tàu
  codeLength: 5, // độ dài mã phòng (4–6 ký tự)
  botRespawnDelay: 6,
  minRespawnDelay: 1, // giây tối thiểu trước khi bấm "Hồi sinh ngay"
  snapDistance: 30, // lệch quá xa thì dịch chuyển tức thì thay vì nội suy
  pickupTolerance: 18, // server chấp nhận nhặt rương trong bán kính này
  flagTolerance: 4, // nới thêm cho bán kính chạm cờ / cứ điểm (bù độ trễ mạng)
};

/** Nâng cấp tàu trong trận bằng Vàng (phím 1–4). Dùng chung client + server. */
export const UPGRADES = {
  costs: [50, 100, 180, 280], // giá cấp 1 → 4
  maxLevel: 4,
  branches: [
    { id: 'hull', key: '1', name: 'Gia cố thân tàu', short: 'Thân tàu', effect: '+25 HP tối đa · hồi ngay 25 HP' },
    { id: 'powder', key: '2', name: 'Thuốc súng hạng nặng', short: 'Thuốc súng', effect: '+15% sát thương đại bác' },
    { id: 'crew', key: '3', name: 'Thủy thủ đoàn tinh nhuệ', short: 'Thủy thủ', effect: '−12% thời gian nạp mạn · nạp tháp nhanh hơn' },
    { id: 'sails', key: '4', name: 'Cánh buồm lớn', short: 'Cánh buồm', effect: '+8% tốc độ · +10% bẻ lái' },
  ],
  hullHp: 25,
  powderPct: 0.15,
  crewPct: 0.12,
  sailSpeedPct: 0.08,
  sailTurnPct: 0.1,
  resupplyMin: 0.8, // thời gian nạp ở tháp khi thủy thủ cấp tối đa
  keepGoldOnDeath: 0.5, // bị chìm giữ lại 50% vàng
};

export const emptyUpgrades = () => ({ hull: 0, powder: 0, crew: 0, sails: 0 });

/** Chỉ số tàu sau nâng cấp (type = thông số gốc từ shipStats, levels = { hull, powder, crew, sails }). */
export function upgradeStats(type, levels = {}) {
  const lv = (k) => Math.max(0, Math.min(UPGRADES.maxLevel, levels[k] | 0));
  const crew = lv('crew');
  return {
    maxHp: type.maxHp + UPGRADES.hullHp * lv('hull'),
    damage: Math.round(type.damage * (1 + UPGRADES.powderPct * lv('powder'))),
    reload: type.reload * (1 - UPGRADES.crewPct * crew),
    resupplyTime: AMMO.resupplyTime - ((AMMO.resupplyTime - UPGRADES.resupplyMin) * crew) / UPGRADES.maxLevel,
    maxSpeed: type.maxSpeed * (1 + UPGRADES.sailSpeedPct * lv('sails')),
    turnRate: type.turnRate * (1 + UPGRADES.sailTurnPct * lv('sails')),
  };
}

/** Kỹ năng "Căng buồm lướt sóng" (phím E / Shift). */
export const SKILL = {
  name: 'Căng buồm lướt sóng',
  cooldown: 18,
  duration: 3.5,
  speedBonus: 0.45,
};

/** Hướng gió: góc gốc theo mapSeed, xoay nhẹ theo chu kỳ (đồng bộ theo giờ server). */
export const WIND = {
  tailBonus: 0.15, // xuôi gió +15% tốc độ
  headPenalty: 0.1, // ngược gió −10%
  swing: 0.5, // biên độ xoay (rad)
  period: 300, // giây cho một chu kỳ xoay
};

/** Góc gió (hướng gió thổi tới, theo quy ước heading) tại thời điểm tSec. */
export function windAngle(seed, tSec) {
  const base = ((seed * 9301 + 49297) % 233280) / 233280 * Math.PI * 2;
  return base + WIND.swing * Math.sin((tSec / WIND.period) * Math.PI * 2);
}

/** Hệ số tốc độ theo gió: xuôi gió tối đa +15%, ngược gió tối đa −10%. */
export function windFactor(heading, wind) {
  const d = Math.cos(heading - wind);
  return d >= 0 ? 1 + WIND.tailBonus * d : 1 + WIND.headPenalty * d;
}

/** Thùng buff phát sáng rơi ra khi tàu chìm (ngoài rương hồi máu). */
export const BUFFS = {
  dropChance: 0.35,
  duration: 15,
  kinds: {
    fire: { id: 'fire', name: 'Đạn lửa', color: 0xff6a1a, css: '#ff7a2a', burnDps: 4, burnTime: 4 },
    rapid: { id: 'rapid', name: 'Nạp đạn thần tốc', color: 0x3d8bfd, css: '#5aa0ff', reloadMul: 0.5 },
  },
};
