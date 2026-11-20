import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plugin quét thư mục public/models lúc dev/build và xuất danh sách model tàu (ship-*.glb)
 * qua module ảo `virtual:ship-models`. Thêm/bớt file tàu là danh sách tự cập nhật.
 */
function shipModelsPlugin() {
  const VIRTUAL_ID = 'virtual:ship-models';
  const RESOLVED_ID = '\0' + VIRTUAL_ID;
  const modelsDir = path.resolve(__dirname, 'public/models');
  const scan = () =>
    fs
      .readdirSync(modelsDir)
      .filter((f) => /^ship-.*\.glb$/i.test(f))
      .map((f) => f.replace(/\.glb$/i, ''))
      .sort();

  return {
    name: 'ship-models',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return `export default ${JSON.stringify(scan())};`;
    },
    configureServer(server) {
      // Tự tải lại khi thêm/xoá file tàu trong lúc chạy dev
      server.watcher.add(modelsDir);
      const reload = (file) => {
        if (!/ship-.*\.glb$/i.test(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

export default defineConfig({
  plugins: [shipModelsPlugin()],
  // host: true -> máy khác trong mạng LAN mở được http://<IP-máy-này>:5173
  server: { port: 5173, open: true, host: true },
  build: {
    // Tách thư viện ra file riêng: trình duyệt cache được lâu, lần cập nhật game sau chỉ tải lại phần code game
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], socket: ['socket.io-client'] },
      },
    },
    chunkSizeWarningLimit: 800, // riêng Three.js đã ~600 kB (gzip ~150 kB), không chia nhỏ hơn được
  },
});
