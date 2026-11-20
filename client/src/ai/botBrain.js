/**
 * Bộ não tàu Bot — logic thuần (chỉ dùng Math, không phụ thuộc Three.js/DOM)
 * để có thể chạy y nguyên trên server khi làm chế độ nhiều người chơi.
 *
 * Mỗi khung hình gọi thinkBot(self, world, mem) -> trả về "input" giống hệt
 * input của người chơi: { forward, backward, left, right, fire, reload }.
 * Như vậy bot tuân thủ đúng vật lý lái, thời gian nạp mạn và giới hạn đạn như người chơi.
 *
 * Quy ước hướng: heading h -> vector tiến (sin h, cos h) trên mặt phẳng XZ.
 * Mạn trái (port) có hướng h + π/2, mạn phải (starboard) h − π/2.
 *
 * @typedef {{x:number,z:number,heading:number,speed:number,maxSpeed:number,radius:number,
 *   reloadLeft:number,reloadRight:number,ammo:number,maxAmmo:number,carrying:boolean,id:string}} BotSelf
 * @typedef {{id:string,x:number,z:number,vx:number,vz:number}} BotTarget
 * @typedef {{x:number,z:number,r:number}} Circle
 * @typedef {{x:number,z:number,radius?:number,loiter?:boolean,urgent?:boolean}} BotGoal
 * @typedef {{time:number,dt:number,targets:BotTarget[],islands:Circle[],forts:Circle[],depots:Circle[],
 *   worldRadius:number,goal?:BotGoal|null}} BotWorld
 */
import { AI } from '../config/game.js';

const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bearing = (fromX, fromZ, toX, toZ) => Math.atan2(toX - fromX, toZ - fromZ);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Tạo bộ nhớ riêng cho một bot. rand: hàm ngẫu nhiên (để server có thể dùng seed). */
export function createBotMemory(rand = Math.random) {
  return {
    rand,
    targetId: null,
    waypoint: null,
    waypointUntil: 0,
    reverseUntil: 0,
    reverseTurn: 1,
    stuckTime: 0,
    preferSide: rand() < 0.5 ? 'left' : 'right',
    loiterDir: rand() < 0.5 ? 1 : -1,
    nextThink: 0,
    decision: { desired: 0, speed: 0.6 },
  };
}

function insideCircle(x, z, c, pad) {
  const dx = x - c.x;
  const dz = z - c.z;
  return dx * dx + dz * dz < (c.r + pad) * (c.r + pad);
}

function pickWaypoint(self, world, mem) {
  const R = world.worldRadius * 0.9;
  for (let i = 0; i < 25; i++) {
    const a = mem.rand() * TAU;
    const d = Math.sqrt(mem.rand()) * R;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (world.islands.some((c) => insideCircle(x, z, c, 18))) continue;
    if (world.forts.some((c) => insideCircle(x, z, c, 5))) continue;
    if (Math.hypot(x - self.x, z - self.z) < 80) continue;
    return { x, z };
  }
  return { x: 0, z: 0 };
}

function chooseTarget(self, world, mem) {
  let current = world.targets.find((t) => t.id === mem.targetId);
  if (current && dist(current, self) > AI.loseRange) current = null;
  if (current) return current;
  let best = null;
  let bestD = AI.detectRange;
  for (const t of world.targets) {
    const d = dist(t, self);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  mem.targetId = best ? best.id : null;
  return best;
}

function nearest(list, self) {
  let best = null;
  let bestD = Infinity;
  for (const c of list) {
    const d = dist(c, self);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Chọn hướng gần với hướng mong muốn nhất mà không đâm vào đảo / ra khỏi bản đồ.
 * Trả về null nếu mọi hướng đều bị chặn.
 */
function avoidObstacles(self, world, desired, avoidForts) {
  const look = 22 + Math.max(0, self.speed) * 2.2;
  const pad = self.radius + 5;
  const offsets = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6, 2.1, -2.1, 2.6, -2.6];
  let best = null;
  let bestCost = Infinity;
  for (const off of offsets) {
    const h = desired + off;
    const sx = Math.sin(h);
    const sz = Math.cos(h);
    let blocked = false;
    let fortCost = 0;
    for (const f of [0.35, 0.7, 1]) {
      const px = self.x + sx * look * f;
      const pz = self.z + sz * look * f;
      if (world.islands.some((c) => insideCircle(px, pz, c, pad))) {
        blocked = true;
        break;
      }
      if (Math.hypot(px, pz) > world.worldRadius + 110) fortCost += 3; // ra rìa bản đồ
      for (const c of world.forts) {
        const d = Math.hypot(px - c.x, pz - c.z);
        if (d < c.r) fortCost += (c.r - d) / c.r;
      }
    }
    if (blocked) continue;
    const cost = Math.abs(off) * 0.8 + fortCost * (avoidForts ? 1.6 : 0.25);
    if (cost < bestCost) {
      bestCost = cost;
      best = h;
    }
  }
  return best;
}

/** Hướng mong muốn khi đấu pháo: xoay ngang mạn đã nạp, giữ khoảng cách lý tưởng. */
function broadsideHeading(self, target, mem) {
  const d = dist(target, self);
  const b = bearing(self.x, self.z, target.x, target.z);
  if (d > AI.engageRange) {
    return { desired: b + (mem.preferSide === 'left' ? -0.25 : 0.25), speed: 1 };
  }
  const portHeading = b - Math.PI / 2; // mục tiêu nằm bên mạn trái
  const starHeading = b + Math.PI / 2; // mục tiêu nằm bên mạn phải
  const leftReady = self.reloadLeft <= 0.4;
  const rightReady = self.reloadRight <= 0.4;
  const dPort = Math.abs(wrap(portHeading - self.heading));
  const dStar = Math.abs(wrap(starHeading - self.heading));
  const usePort = leftReady !== rightReady ? leftReady : dPort <= dStar;
  mem.preferSide = usePort ? 'left' : 'right';
  const closing = Math.max(-0.5, Math.min(0.5, (d - AI.idealRange) / 40));
  return { desired: (usePort ? portHeading : starHeading) + (usePort ? closing : -closing), speed: AI.combatSpeed };
}

/**
 * @param {BotSelf} self
 * @param {BotWorld} world
 * @param {ReturnType<typeof createBotMemory>} mem
 */
export function thinkBot(self, world, mem) {
  const out = { forward: false, backward: false, left: false, right: false, fire: null, reload: false };
  const t = world.time;

  // --- Đang lùi để thoát kẹt ---
  if (t < mem.reverseUntil) {
    out.backward = true;
    if (mem.reverseTurn > 0) out.left = true;
    else out.right = true;
    return out;
  }

  const needAmmo = self.ammo <= 0;
  const depot = needAmmo ? nearest(world.depots || [], self) : null;
  const atDepot = depot && dist(depot, self) < depot.r * 0.75;
  const target = chooseTarget(self, world, mem);
  // Giữ cờ hoặc hết đạn thì không lao vào đánh nhau
  const engage = target && !needAmmo && !(self.carrying || world.goal?.urgent);

  // --- Ra quyết định (có độ trễ phản xạ nhỏ để bot trông "người" hơn) ---
  if (t >= mem.nextThink) {
    mem.nextThink = t + 0.08 + mem.rand() * AI.thinkJitter;
    let desired;
    let speedFactor;
    let avoidForts = true;

    if (atDepot) {
      desired = self.heading;
      speedFactor = 0; // dừng lại trong vùng tháp để nạp
    } else if (depot) {
      desired = bearing(self.x, self.z, depot.x, depot.z);
      speedFactor = 1;
    } else if (engage) {
      avoidForts = false;
      ({ desired, speed: speedFactor } = broadsideHeading(self, target, mem));
    } else if (world.goal) {
      const g = world.goal;
      const d = dist(g, self);
      const b = bearing(self.x, self.z, g.x, g.z);
      if (g.loiter && d < (g.radius || 40)) {
        // Lượn vòng quanh điểm canh gác
        desired = b + (Math.PI / 2) * mem.loiterDir * 0.8;
        speedFactor = AI.patrolSpeed * 0.8;
      } else {
        desired = b;
        speedFactor = g.urgent ? 1 : 0.85;
      }
    } else {
      if (!mem.waypoint || t > mem.waypointUntil || dist(mem.waypoint, self) < 30) {
        mem.waypoint = pickWaypoint(self, world, mem);
        mem.waypointUntil = t + 45;
      }
      desired = bearing(self.x, self.z, mem.waypoint.x, mem.waypoint.z);
      speedFactor = AI.patrolSpeed;
    }

    const safe = speedFactor === 0 ? desired : avoidObstacles(self, world, desired, avoidForts);
    if (safe === null) {
      mem.reverseUntil = t + 1.6;
      mem.reverseTurn = mem.rand() < 0.5 ? 1 : -1;
      mem.waypoint = null;
      return { ...out, backward: true };
    }
    mem.decision.desired = safe;
    mem.decision.speed = speedFactor;
  }

  // --- Lái theo hướng đã chọn ---
  const diff = wrap(mem.decision.desired - self.heading);
  if (mem.decision.speed > 0) {
    if (diff > 0.05) out.left = true;
    else if (diff < -0.05) out.right = true;
  }
  const targetSpeed = self.maxSpeed * mem.decision.speed * (Math.abs(diff) > 1.2 ? 0.6 : 1);
  if (self.speed < targetSpeed - 0.3) out.forward = true;
  else if (self.speed > targetSpeed + (targetSpeed === 0 ? 0.3 : 2.5)) out.backward = true;

  if (atDepot) out.reload = true;

  // Kỹ năng lướt sóng: dùng khi đang giữ cờ, đang chạy về tháp, hoặc đuổi theo mục tiêu ở xa
  if (self.boostReady && self.speed > 4 && Math.abs(diff) < 0.4) {
    const chasing = target && dist(target, self) > AI.engageRange * 1.4;
    if (self.carrying || depot || world.goal?.urgent || chasing) out.boost = true;
  }

  // --- Phát hiện bị kẹt (muốn chạy mà không nhúc nhích) ---
  if (out.forward && self.speed < 1.2) mem.stuckTime += world.dt;
  else mem.stuckTime = Math.max(0, mem.stuckTime - world.dt);
  if (mem.stuckTime > 2.2) {
    mem.stuckTime = 0;
    mem.reverseUntil = t + 1.8;
    mem.reverseTurn = diff > 0 ? -1 : 1;
  }

  // --- Bắn khi mục tiêu nằm ngang mạn và trong tầm (kể cả lúc đang chạy về) ---
  if (target && self.ammo > 0) {
    const d = dist(target, self);
    if (d < AI.fireRange) {
      const flight = d / 38;
      const aim = bearing(self.x, self.z, target.x + target.vx * flight, target.z + target.vz * flight);
      if (self.reloadLeft <= 0 && Math.abs(wrap(aim - (self.heading + Math.PI / 2))) < AI.fireAngle) out.fire = 'left';
      else if (self.reloadRight <= 0 && Math.abs(wrap(aim - (self.heading - Math.PI / 2))) < AI.fireAngle) out.fire = 'right';
    }
  }

  return out;
}
