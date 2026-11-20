import { AMMO, RAM, LOOT, NET, CTF, RESPAWN, COMBAT, MODES, UPGRADES, SKILL, WIND, BUFFS } from '../config/game.js';

const key = (k) => `<kbd>${k}</kbd>`;
const num = (v) => `<span class="num">${String(v).replace('.', ',')}</span>`;
const STORAGE_KEY = 'pirate-battle:guide-tab';

/** Các mục hướng dẫn — mỗi mục là một tab riêng. Số liệu lấy từ config nên luôn khớp với luật thật. */
function sections() {
  const controls = [
    [`${key('W')} ${key('S')}`, 'Tăng tốc / giảm tốc, lùi (có quán tính)'],
    [`${key('A')} ${key('D')}`, 'Xoay bánh lái trái / phải, buông ra tự trả về giữa'],
    [key('Space'), 'Bắn cả hai mạn (tốn 2 lần bắn)'],
    ['Click chuột', 'Bắn mạn phía có trỏ chuột (tốn 1 lần bắn)'],
    [key('R'), 'Nạp đạn khi đang ở trong vùng tháp tiếp đạn'],
    [`${key('1')}–${key('4')}`, 'Nâng cấp tàu bằng vàng'],
    [`${key('E')} ${key('Shift')}`, `Kỹ năng “${SKILL.name}”`],
    [key('Tab'), 'Giữ để xem bảng xếp hạng'],
    [key('M'), 'Mở / đóng bản đồ lớn'],
    [key('N'), 'Bật / tắt nhạc nền'],
    [key('Esc'), 'Tạm dừng (chơi đơn) · mở menu (online)'],
    ['Lăn chuột', 'Zoom camera · trên minimap: zoom bản đồ'],
    [`${key('Enter')} ${key('←')} ${key('→')}`, 'Ở menu: vào trận · đổi tàu'],
  ];

  return [
    {
      id: 'controls',
      tab: 'Điều khiển',
      body: `<dl class="guide-keys">${controls.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`,
    },
    {
      id: 'modes',
      tab: 'Chế độ',
      body: `<ul>
        <li><strong>${MODES.tdm.name}</strong> — đội nào bắn chìm đủ số tàu đối phương trước thì thắng (mặc định ${num(MODES.tdm.defaultTarget)}). Chìm vì đâm đảo hay pháo đài không tính điểm.</li>
        <li><strong>${MODES.ctf.name}</strong> — mỗi đội 2 cứ điểm, mỗi cứ điểm 1 lá cờ. Cướp cờ ở cứ điểm địch, mang về cứ điểm mình để ghi điểm (mặc định ${num(MODES.ctf.defaultTarget)} cờ).</li>
        <li><strong>Tự do</strong> (chỉ online) — ai cũng là đối thủ, xếp hạng theo số tàu hạ được và vàng.</li>
        <li><strong>Chơi đơn</strong> chơi với bot, không cần mạng. <strong>Online</strong> tự ghép phòng chung. <strong>Phòng riêng</strong> tạo mã mời bạn bè (cần chạy server).</li>
      </ul>`,
    },
    {
      id: 'combat',
      tab: 'Chiến đấu',
      body: `<ul>
        <li>Pháo nằm hai bên mạn tàu: phải <strong>xoay ngang</strong> mới bắn trúng. Mỗi mạn nạp lại riêng (1,6–2,7 giây tuỳ tàu).</li>
        <li>Rê chuột sang mạn nào sẽ hiện <strong>vùng ngắm</strong> của mạn đó: xanh ngọc = sẵn sàng, đỏ = đang nạp / hết đạn.</li>
        <li>Mỗi tàu chỉ có ${num(AMMO.max)} lần bắn. Hết đạn thì tới <strong>tháp tiếp đạn</strong> (vòng trắng), bấm ${key('R')} và đứng yên ${num(AMMO.resupplyTime)} giây.</li>
        <li>Sát thương mỗi viên phụ thuộc loại tàu. Đạn bay xuyên qua tàu đồng đội.</li>
        <li>Hạ gục một tàu được +${num(NET.killGold)} vàng.</li>
      </ul>`,
    },
    {
      id: 'upgrades',
      tab: 'Nâng cấp',
      body: `<ul>
        ${UPGRADES.branches.map((b) => `<li>${key(b.key)} <strong>${b.name}</strong> — ${b.effect}.</li>`).join('')}
        <li>Mỗi nhánh tối đa ${num(UPGRADES.maxLevel)} cấp, giá ${num(UPGRADES.costs.join(' / '))} vàng.</li>
        <li>Bị chìm vẫn giữ cấp đã nâng, chỉ mất ${num('50%')} vàng đang có.</li>
      </ul>`,
    },
    {
      id: 'skills',
      tab: 'Kỹ năng · Gió',
      body: `<ul>
        <li><strong>${SKILL.name}</strong> (${key('E')} / ${key('Shift')}): +${num(Math.round(SKILL.speedBonus * 100) + '%')} tốc độ trong ${num(SKILL.duration)} giây, hồi chiêu ${num(SKILL.cooldown)} giây.</li>
        <li><strong>Gió</strong>: mũi tên “GIÓ” trên viền minimap. Chạy xuôi gió +${num(Math.round(WIND.tailBonus * 100) + '%')} tốc độ, ngược gió −${num(Math.round(WIND.headPenalty * 100) + '%')}.</li>
        <li><strong>Thùng buff</strong> phát sáng thỉnh thoảng rơi khi tàu chìm, hiệu lực ${num(BUFFS.duration)} giây:
          <ul>
            <li><strong style="color:${BUFFS.kinds.fire.css}">${BUFFS.kinds.fire.name}</strong> — tàu trúng đạn bị cháy ${BUFFS.kinds.fire.burnDps} HP/giây trong ${BUFFS.kinds.fire.burnTime} giây.</li>
            <li><strong style="color:${BUFFS.kinds.rapid.css}">${BUFFS.kinds.rapid.name}</strong> — giảm 50% thời gian nạp mạn.</li>
          </ul>
        </li>
      </ul>`,
    },
    {
      id: 'danger',
      tab: 'Nguy hiểm',
      body: `<ul>
        <li><strong>Đâm vào đất liền</strong> khi đang chạy: mất ${num(RAM.damage)} máu.</li>
        <li><strong>Pháo đài</strong> trên đảo bắn mọi tàu trong vòng đỏ nét đứt (${num(COMBAT.fortDamage)} sát thương / viên).</li>
        <li>Tàu chìm rớt <strong>rương / thùng</strong> nổi trên biển: chạm vào để hồi +${num(LOOT.heal)} máu và nhận vàng.</li>
        <li>Bị chìm sẽ hồi sinh tại cứ điểm của đội sau ${num(RESPAWN.playerDelay)} giây (online: bấm “Hồi sinh ngay”).</li>
      </ul>`,
    },
    {
      id: 'ctf',
      tab: 'Cướp cờ',
      body: `<ul>
        <li>Lái vào vòng cứ điểm địch để cướp cờ, mang về bất kỳ cứ điểm nào của đội mình để ghi 1 điểm.</li>
        <li>Đang giữ cờ thì tàu chạy chậm hơn ${num(Math.round((1 - CTF.carrierSpeedFactor) * 100) + '%')} và không nên lao vào đánh nhau.</li>
        <li>Người giữ cờ bị chìm: cờ rơi tại chỗ. Đồng đội chạm vào để trả cờ về, địch chạm vào để cướp tiếp. Sau ${num(CTF.dropReturnTime)} giây cờ tự về.</li>
      </ul>`,
    },
    {
      id: 'map',
      tab: 'Bản đồ',
      body: `<ul class="guide-legend">
        <li><i class="lg lg-me"></i>Tàu của bạn</li>
        <li><i class="lg lg-blue"></i>Đội Xanh</li>
        <li><i class="lg lg-red"></i>Đội Đỏ / đối thủ</li>
        <li><i class="lg lg-depot"></i>Tháp tiếp đạn</li>
        <li><i class="lg lg-fort"></i>Tầm bắn pháo đài</li>
        <li><i class="lg lg-loot"></i>Rương kho báu</li>
      </ul>`,
    },
    {
      id: 'tips',
      tab: 'Mẹo',
      body: `<ul>
        <li>Đừng bắn hết đạn một lúc: giữ lại vài lượt để tự vệ trên đường về tháp.</li>
        <li>Giảm tốc trước khi cua gấp gần đảo để khỏi đâm vào bờ.</li>
        <li>Chạy xuôi gió khi cần đuổi hoặc bỏ chạy; để dành kỹ năng lướt sóng cho lúc giữ cờ.</li>
        <li>Tàu nhỏ hợp cướp cờ; tàu lớn và tàu ma hợp giữ cứ điểm, đấu pháo.</li>
      </ul>`,
    },
  ];
}

function loadTab() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** HTML tab "Hướng dẫn chơi": hàng tab mục nhỏ + nội dung mục đang chọn. */
export function guideHtml() {
  const list = sections();
  const active = list.some((s) => s.id === loadTab()) ? loadTab() : list[0].id;
  return `
    <div class="guide-tabs" role="tablist">
      ${list.map((s) => `<button type="button" role="tab" data-gtab="${s.id}" class="${s.id === active ? 'active' : ''}">${s.tab}</button>`).join('')}
    </div>
    ${list
      .map((s) => `<section class="guide-sec" data-gsec="${s.id}" ${s.id === active ? '' : 'hidden'}><h3>${s.tab}</h3>${s.body}</section>`)
      .join('')}`;
}

/** Gắn sự kiện chuyển mục cho tab hướng dẫn (gọi sau khi chèn guideHtml vào trang). */
export function bindGuide(root) {
  const tabs = root.querySelectorAll('[data-gtab]');
  const secs = root.querySelectorAll('[data-gsec]');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      const id = t.dataset.gtab;
      tabs.forEach((x) => {
        x.classList.toggle('active', x === t);
        x.setAttribute('aria-selected', x === t);
      });
      secs.forEach((s) => (s.hidden = s.dataset.gsec !== id));
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* bỏ qua */
      }
    }),
  );
}
