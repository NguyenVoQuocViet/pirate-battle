import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Ocean } from './ocean.js';
import { Effects } from './effects.js';
import { CameraRig } from './cameraRig.js';
import { Islands, ISLAND_PROP_MODELS } from './islands.js';
import { Minimap } from './minimap.js';
import { Projectiles } from './combat/projectiles.js';
import { Sound } from './audio/sound.js';
import { Music } from './audio/music.js';
import { Game } from './game.js';
import { SHIP_TYPES } from './config/ships.js';
import { LOOT } from './config/game.js';
import { STRUCTURE_MODELS } from './world/structures.js';

const MODELS = '/models/';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0xa8c6dc);
const fogDensity = 0.0022;
scene.fog = new THREE.FogExp2(fogColor, fogDensity);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 30000);

// ---------- Bầu trời + mặt trời ----------
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(150));

const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 6;
su.rayleigh.value = 1.6;
su.mieCoefficient.value = 0.005;
su.mieDirectionalG.value = 0.85;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

// Môi trường phản chiếu cho vật liệu PBR của mô hình
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(sky.clone());
scene.environment = pmrem.fromScene(skyScene).texture;

const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -25;
sc.right = sc.top = 25;
sc.near = 1;
sc.far = 200;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbfd9f2, 0x1d4a66, 0.6));

// ---------- Biển ----------
const ocean = new Ocean(scene, { sunDir, fogColor, fogDensity });
const effects = new Effects(scene, ocean);


// ---------- Input ----------
const keys = {};
let game = null;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && game && game.state !== 'menu') {
    e.preventDefault(); // không để Tab nhảy focus giữa các nút
    if (!e.repeat) game.setScoreboard(true);
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  keys[e.code] = true;
  if (!game) return;
  game.sound.unlock();
  if (game.state === 'menu') {
    if (e.code === 'Enter') game.menu.start();
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') game.menu.cycleShip(1);
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') game.menu.cycleShip(-1);
    return;
  }
  if (e.code === 'Escape') game.togglePause();
  if (e.code === 'KeyN' && !e.repeat) game.toggleMusic();
  // Nâng cấp 1–4, kỹ năng E / Shift
  const up = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (up >= 0 && !e.repeat) game.buyUpgrade(up);
  if ((e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) game.useBoost();
  if (e.code === 'KeyM' && !e.repeat && game.state !== 'paused') minimap.toggle();
  if (e.code === 'KeyR' && !e.repeat && (game.state === 'playing' || game.state === 'online')) game.playerReloadRequest = true;
  if (e.code === 'Space') {
    e.preventDefault();
    game.fire('both');
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') game?.setScoreboard(false);
});
window.addEventListener('blur', () => {
  game?.setScoreboard(false);
  Object.keys(keys).forEach((k) => (keys[k] = false));
  if (game?.state === 'playing') game.pause(); // trận online không tự dừng khi chuyển tab
});
window.addEventListener('pointerdown', () => game?.sound.unlock());

// ---------- Nạp mô hình ----------
const loader = new GLTFLoader();
const loadingEl = document.getElementById('loading');
let loaded = 0;
let total = 0;
const load = (name) => {
  total++;
  return loader.loadAsync(MODELS + name).then((g) => {
    loaded++;
    loadingEl.textContent = `Đang nạp mô hình… ${loaded}/${total}`;
    return g.scene;
  });
};

let minimap, projectiles;

async function init() {
  const lootKinds = Object.entries(LOOT.kinds);
  const [shipModels, ballModel, lootModels, propModels] = await Promise.all([
    Promise.all(SHIP_TYPES.map((t) => load(t.file).then((m) => [t.id, m]))).then(Object.fromEntries),
    load('cannon-ball.glb').catch(() => null),
    Promise.all(lootKinds.map(([kind, cfg]) => load(cfg.model + '.glb').then((m) => [kind, m]).catch(() => [kind, null]))).then(Object.fromEntries),
    Promise.all(
      [...new Set([...ISLAND_PROP_MODELS, ...STRUCTURE_MODELS])].map((n) =>
        load(n + '.glb')
          .then((m) => [n, m])
          .catch(() => {
            console.warn('Không nạp được', n);
            return [n, null];
          }),
      ),
    ).then(Object.fromEntries),
  ]);
  if (ballModel) ballModel.scale.setScalar(1.2);

  const islands = new Islands(scene, propModels);
  const sound = new Sound();
  const music = new Music(sound);
  sound.onUnlock = () => music.start(); // trình duyệt chỉ cho phát sau thao tác đầu tiên
  projectiles = new Projectiles({ scene, effects, ocean, islands, sound, ballTemplate: ballModel });
  minimap = new Minimap({ islands, projectiles });
  const rig = new CameraRig(camera, renderer.domElement, null);

  game = new Game({
    scene,
    camera,
    ocean,
    effects,
    islands,
    sound,
    music,
    rig,
    minimap,
    projectiles,
    shipTemplates: shipModels,
    lootTemplates: lootModels,
    structureModels: propModels,
    keys,
  });

  if (import.meta.env.DEV) window.__game = game; // tiện debug trong console

  loadingEl.remove();
  renderer.setAnimationLoop(tick);
}

// ---------- Vòng lặp ----------
const clock = new THREE.Clock();
let elapsed = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state !== 'paused') elapsed += dt;

  game.update(dt, elapsed);

  const focus = game.focus;
  ocean.update(elapsed, focus);
  // Bóng đổ đi theo tàu
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sunDir, 100);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init().catch((err) => {
  console.error(err);
  loadingEl.textContent = 'Lỗi nạp mô hình: ' + err.message;
});
