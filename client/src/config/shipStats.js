/**
 * Chỉ số các loại tàu — dữ liệu thuần, không phụ thuộc Vite/Three.js.
 * Dùng chung cho client (menu, vật lý) và server (tính sát thương, máu tối đa).
 */

/** Thông số mặc định theo cỡ tàu. */
export const SIZE_DEFAULTS = {
  small: { maxSpeed: 19, accel: 4.2, turnRate: 0.8, maxHp: 75, damage: 10, reload: 1.8, guns: 2, scale: 0.95 },
  medium: { maxSpeed: 16, accel: 3.4, turnRate: 0.6, maxHp: 115, damage: 14, reload: 2.2, guns: 3, scale: 1.0 },
  large: { maxSpeed: 13, accel: 2.7, turnRate: 0.45, maxHp: 170, damage: 19, reload: 2.6, guns: 4, scale: 1.08 },
};

/**
 * Thông số riêng từng model.
 * maxSpeed (đv/s) · accel · turnRate (rad/s) · maxHp · damage (mỗi viên) · reload (giây/mạn) · guns (số pháo mỗi mạn)
 */
export const PRESETS = {
  'ship-pirate-small': {
    name: 'Cá Kiếm',
    role: 'Thuyền buồm nhẹ',
    desc: 'Nhanh, bẻ lái gắt, nhưng vỏ mỏng.',
    maxSpeed: 20, accel: 4.6, turnRate: 0.85, maxHp: 70, damage: 10, reload: 1.7, guns: 2, scale: 0.95,
  },
  'ship-small': {
    name: 'Hải Âu',
    role: 'Thuyền trinh sát',
    desc: 'Linh hoạt, nạp đạn nhanh.',
    maxSpeed: 18.5, accel: 4.2, turnRate: 0.8, maxHp: 80, damage: 9, reload: 1.6, guns: 2, scale: 0.95,
  },
  'ship-pirate-medium': {
    name: 'Rắn Biển',
    role: 'Tàu hải tặc cân bằng',
    desc: 'Cân bằng giữa tốc độ, máu và hoả lực.',
    maxSpeed: 16, accel: 3.4, turnRate: 0.6, maxHp: 115, damage: 14, reload: 2.2, guns: 3, scale: 1.0,
  },
  'ship-medium': {
    name: 'Thương Thuyền',
    role: 'Tàu vũ trang',
    desc: 'Vỏ dày hơn tàu hải tặc cùng cỡ.',
    maxSpeed: 15, accel: 3.2, turnRate: 0.56, maxHp: 130, damage: 13, reload: 2.2, guns: 3, scale: 1.0,
  },
  'ship-pirate-large': {
    name: 'Bạo Chúa',
    role: 'Chiến hạm hải tặc',
    desc: 'Bốn khẩu mỗi mạn, bắn rất đau, xoay chậm.',
    maxSpeed: 13, accel: 2.7, turnRate: 0.44, maxHp: 175, damage: 20, reload: 2.6, guns: 4, scale: 1.08,
  },
  'ship-large': {
    name: 'Hạm Đội Trưởng',
    role: 'Chiến hạm hoàng gia',
    desc: 'Pháo đài nổi: máu trâu nhất, chậm nhất.',
    maxSpeed: 12, accel: 2.5, turnRate: 0.42, maxHp: 200, damage: 18, reload: 2.7, guns: 4, scale: 1.08,
  },
  'ship-ghost': {
    name: 'U Linh',
    role: 'Tàu ma',
    desc: 'Đạn nguyền rủa sát thương cực lớn.',
    maxSpeed: 14, accel: 3.0, turnRate: 0.5, maxHp: 155, damage: 24, reload: 2.5, guns: 3, scale: 1.02,
  },
  // Xác tàu: có trong thư mục nhưng không lái được
  'ship-wreck': { playable: false },
};

export function sizeOf(id) {
  if (/small/.test(id)) return 'small';
  if (/large/.test(id)) return 'large';
  return 'medium';
}

export function titleCase(id) {
  return id
    .replace(/^ship-/, '')
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}


/** Có chơi được không (xác tàu thì không). */
export function isPlayable(id) {
  return /^ship-/.test(id) && PRESETS[id]?.playable !== false;
}

/** Ghép thông số đầy đủ cho một model tàu. */
export function buildShipType(id) {
  const preset = PRESETS[id] || {};
  return {
    id,
    file: `${id}.glb`,
    name: titleCase(id),
    role: 'Tàu',
    desc: '',
    ...SIZE_DEFAULTS[sizeOf(id)],
    ...preset,
  };
}
