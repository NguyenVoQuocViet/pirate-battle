# Pirate Battle

Game hải chiến cướp biển 3D chạy trên trình duyệt: lái tàu, xoay mạn bắn đại bác, cướp cờ, nâng cấp tàu — chơi một mình với bot hoặc online với bạn bè.

**Chơi thử:** https://piratebattle.pages.dev

## Tính năng

- **7 mẫu tàu** với chỉ số riêng (tốc độ, bẻ lái, máu, sát thương); quần đảo có pháo đài, tháp tiếp đạn, gió và sóng biển.
- **Chế độ:** Đối đầu đồng đội, Cướp cờ, Tự do (online). Chơi đơn với bot AI hoặc online qua phòng chung / phòng riêng có mã mời.
- **Gameplay:** 10 lượt bắn mỗi lần nạp, nâng cấp tàu bằng vàng, kỹ năng lướt sóng, thùng buff (đạn lửa, nạp đạn thần tốc), rương kho báu.
- **Âm thanh & nhạc nền** tổng hợp bằng Web Audio — không dùng file âm thanh ngoài.
- Hỗ trợ màn hình cảm ứng (joystick ảo).

## Điều khiển

| Phím | Tác dụng |
|---|---|
| `W` `S` / `A` `D` | Ga – phanh / bánh lái |
| `Space` · click chuột | Bắn hai mạn · bắn mạn phía trỏ chuột |
| `R` | Nạp đạn tại tháp tiếp đạn |
| `1`–`4` | Nâng cấp tàu |
| `E` / `Shift` | Kỹ năng lướt sóng |
| `Tab` · `M` · `N` · `Esc` | Bảng xếp hạng · bản đồ lớn · nhạc nền · menu |

## Chạy trên máy

Cần Node.js 18 trở lên.

```bash
# Server (cổng 3001) — chỉ cần cho chế độ online
cd server
npm install
npm start

# Client (http://localhost:5173)
cd client
npm install
npm run dev
```

## Công nghệ

- **client/** — Vite, Three.js, Socket.io client, Web Audio API
- **server/** — Node.js, Express, Socket.io (server làm trọng tài máu, điểm, rương; dùng chung cấu hình với client)

## Deploy

Backend lên Render, frontend lên Cloudflare Pages / Netlify — xem hướng dẫn chi tiết trong [DEPLOY.md](DEPLOY.md).

## Bản quyền tài nguyên

Mô hình 3D trong `client/public/models` thuộc bộ asset low-poly cướp biển của Kenney (giấy phép CC0).
