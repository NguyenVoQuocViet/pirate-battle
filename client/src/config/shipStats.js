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
    name: 'Đá Số Tăng Ga',
    role: 'Thuyền buồm nhẹ',
    desc: 'Chạy nhanh như người yêu cũ, đụng nhẹ là chìm',
    maxSpeed: 20, accel: 4.6, turnRate: 0.85, maxHp: 70, damage: 10, reload: 1.7, guns: 2, scale: 0.95,
  },
  'ship-small': {
    name: 'Ninja Lead Đại Dương',
    role: 'Thuyền trinh sát',
    desc: 'Xi-nhan trái rẽ phải, địch không kịp trở tay',
    maxSpeed: 18.5, accel: 4.2, turnRate: 0.8, maxHp: 80, damage: 9, reload: 1.6, guns: 2, scale: 0.95,
  },
  'ship-pirate-medium': {
    name: 'Báo Thủ Vùng Vịnh',
    role: 'Tàu hải tặc cân bằng',
    desc: 'Cân bằng mọi kèo, chuyên đi báo đồng đội',
    maxSpeed: 16, accel: 3.4, turnRate: 0.6, maxHp: 115, damage: 14, reload: 2.2, guns: 3, scale: 1.0,
  },
  'ship-medium': {
    name: 'Tàu Chở Đam Mê',
    role: 'Tàu vũ trang',
    desc: 'Công thủ toàn diện, mỗi tội hay chìm',
    maxSpeed: 15, accel: 3.2, turnRate: 0.56, maxHp: 130, damage: 13, reload: 2.2, guns: 3, scale: 1.0,
  },
  'ship-pirate-large': {
    name: 'Đòi Nợ Thuê',
    role: 'Chiến hạm hải tặc',
    desc: 'Bắn một phát bay màu sổ đỏ',
    maxSpeed: 13, accel: 2.7, turnRate: 0.44, maxHp: 175, damage: 20, reload: 2.6, guns: 4, scale: 1.08,
  },
  'ship-large': {
    name: 'Biệt Phủ Nổi',
    role: 'Chiến hạm hoàng gia',
    desc: 'To như cái đảo, né đạn bằng niềm tin',
    maxSpeed: 12, accel: 2.5, turnRate: 0.42, maxHp: 200, damage: 18, reload: 2.7, guns: 4, scale: 1.08,
  },
  'ship-ghost': {
    name: 'U Linh Deadline',
    role: 'Tàu ma',
    desc: 'Vừa trâu vừa dị, nhìn thấy là sang chấn tâm lý',
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
