# Deploy Pirate Battle

Frontend (thư mục `client`, Vite) và backend (thư mục `server`, Node + Socket.io) deploy riêng:

- **Backend → Render** (Web Service, chạy liên tục, giữ kết nối WebSocket)
- **Frontend → Netlify** hoặc **Cloudflare Pages** (file tĩnh)

> Làm backend trước để có địa chỉ server, rồi mới build frontend.

## 1. Đưa code lên GitHub

```bash
cd D:\Projects\pirate-battle
git init
git add .
git commit -m "Pirate Battle"
# Tạo repo trống trên github.com rồi:
git remote add origin https://github.com/<tài-khoản>/pirate-battle.git
git branch -M main
git push -u origin main
```

`.gitignore` đã loại `node_modules`, `client/dist` và mọi file `.env`.

## 2. Backend trên Render

**Cách nhanh (Blueprint):** Render → **New → Blueprint** → chọn repo. Render đọc `render.yaml` và tự cấu hình.

**Hoặc tạo tay:** **New → Web Service** → chọn repo, điền:

| Mục | Giá trị |
|---|---|
| Root Directory | *(để trống — server dùng chung file trong `client/src/config`)* |
| Runtime | Node |
| Build Command | `npm install --prefix server` |
| Start Command | `npm start --prefix server` |
| Health Check Path | `/` |
| Biến môi trường | `CLIENT_URL` = địa chỉ frontend (điền sau ở bước 4) |

Deploy xong, mở `https://<tên>.onrender.com/` → thấy `Pirate Battle Server is running` là được.

> Gói miễn phí: server ngủ sau ~15 phút không ai vào, lần vào đầu tiên mất ~30–60 giây để thức dậy.
> Menu Online sẽ hiện "Đang kết nối máy chủ, vui lòng chờ…" và tự đánh thức server ngay khi chọn tab Online.

## 3. Frontend

Biến môi trường **bắt buộc** khi build: `VITE_SERVER_URL` = địa chỉ server Render ở bước 2
(vd `https://pirate-battle-server.onrender.com`, không cần dấu `/` cuối).

### Netlify
**Add new site → Import an existing project** → chọn repo. `netlify.toml` đã khai báo sẵn
(base `client`, lệnh `npm run build`, thư mục `dist`). Chỉ cần thêm `VITE_SERVER_URL` trong
**Site configuration → Environment variables** rồi **Deploy** (hoặc **Trigger deploy** nếu đã build trước khi thêm biến).

### Cloudflare Pages
**Workers & Pages → Create → Pages → Connect to Git** → chọn repo, điền:

| Mục | Giá trị |
|---|---|
| Framework preset | Vite (hoặc None) |
| Root directory | `client` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `VITE_SERVER_URL` = địa chỉ server Render, `NODE_VERSION` = `20` |

## 4. Khoá CORS (nên làm)

Có link frontend rồi (vd `https://pirate-battle.netlify.app`), vào Render → service → **Environment** →
đặt `CLIENT_URL` = link đó (nhiều link thì cách nhau dấu phẩy) → server tự khởi động lại.
Từ đó chỉ trang game của bạn mới kết nối được server.

## Lưu ý

- Đổi `VITE_SERVER_URL` thì phải **build lại** frontend (biến được nhúng lúc build).
- Phòng chơi lưu trong bộ nhớ server: chỉ chạy **1 instance**; server khởi động lại thì các phòng đang chơi mất.
- Chạy thử trên máy: `npm start` trong `server`, `npm run dev` trong `client` (không cần biến môi trường).
