/**
 * Cấu hình các loại tàu. File này chỉ chứa dữ liệu thuần (không phụ thuộc Three.js)
 * để server sau này import lại y nguyên khi đồng bộ trạng thái.
 *
 * Danh sách model được quét tự động từ client/public/models (ship-*.glb) qua plugin Vite.
 * Model nào có trong PRESETS dùng thông số riêng; model mới chưa khai báo sẽ được
 * suy ra thông số mặc định theo từ khoá small/medium/large trong tên file.
 */
import scannedShipModels from 'virtual:ship-models';
import { isPlayable, buildShipType } from './shipStats.js';

/** Tất cả loại tàu chơi được, theo thứ tự quét. */
export const SHIP_TYPES = scannedShipModels.filter(isPlayable).map(buildShipType);

export const DEFAULT_SHIP_ID = SHIP_TYPES.find((t) => t.id === 'ship-pirate-medium')?.id ?? SHIP_TYPES[0]?.id;

export function getShipType(id) {
  return SHIP_TYPES.find((t) => t.id === id) ?? SHIP_TYPES[0];
}

/** Các chỉ số hiển thị ở menu (thanh trạng thái chuẩn hoá theo tàu mạnh nhất). */
export const DISPLAY_STATS = [
  { key: 'maxSpeed', label: 'Tốc độ' },
  { key: 'turnRate', label: 'Bẻ lái' },
  { key: 'maxHp', label: 'Máu tối đa' },
  { key: 'damage', label: 'Sát thương' },
];

const maxOf = (key) => Math.max(...SHIP_TYPES.map((t) => t[key]));
const minOf = (key) => Math.min(...SHIP_TYPES.map((t) => t[key]));

/** Giá trị 0..1 cho thanh chỉ số (tàu yếu nhất vẫn có ~25% thanh). */
export function statRatio(type, key) {
  const lo = minOf(key);
  const hi = maxOf(key);
  if (hi === lo) return 1;
  return 0.25 + 0.75 * ((type[key] - lo) / (hi - lo));
}
