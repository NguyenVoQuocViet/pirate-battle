import * as THREE from 'three';

// Mỗi sóng: hướng (dx, dz), biên độ, bước sóng, tốc độ, pha.
// Hàm getHeight() trên CPU dùng đúng công thức với shader để tàu/đạn khớp mặt nước.
const WAVES = [
  { dir: [1.0, 0.3], amp: 0.45, len: 60, speed: 6.0, phase: 0.0 },
  { dir: [-0.4, 1.0], amp: 0.3, len: 37, speed: 4.5, phase: 1.7 },
  { dir: [0.7, -0.7], amp: 0.18, len: 21, speed: 3.6, phase: 4.1 },
  { dir: [-0.9, -0.2], amp: 0.1, len: 11, speed: 2.7, phase: 2.3 },
];

for (const w of WAVES) {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  w.dir = [w.dir[0] / l, w.dir[1] / l];
  w.k = (2 * Math.PI) / w.len;
}

const MAX_WAVES = WAVES.length;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmpScale;
  uniform vec4 uWaveA[${MAX_WAVES}]; // dir.x, dir.y, amp, k
  uniform vec2 uWaveB[${MAX_WAVES}]; // speed, phase

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float h = 0.0;
    float dhdx = 0.0;
    float dhdz = 0.0;
    for (int i = 0; i < ${MAX_WAVES}; i++) {
      vec2 d = uWaveA[i].xy;
      float a = uWaveA[i].z * uAmpScale;
      float k = uWaveA[i].w;
      float arg = k * (dot(d, world.xz) - uWaveB[i].x * uTime) + uWaveB[i].y;
      h += a * sin(arg);
      float c = a * k * cos(arg);
      dhdx += c * d.x;
      dhdz += c * d.y;
    }
    world.y += h;
    vHeight = h;
    vWorldPos = world.xyz;
    vNormal = normalize(vec3(-dhdx, 1.0, -dhdz));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  // Gợn sóng nhỏ bằng nhiễu sin để mặt nước không quá phẳng.
  vec3 rippleNormal(vec2 p) {
    float t = uTime;
    float nx = sin(p.x * 0.9 + t * 1.3) * 0.5 + sin(p.y * 1.7 - t * 1.1 + p.x * 0.4) * 0.3 + sin((p.x + p.y) * 2.9 + t * 2.0) * 0.2;
    float nz = sin(p.y * 1.1 - t * 1.2) * 0.5 + sin(p.x * 1.5 + t * 0.9 - p.y * 0.3) * 0.3 + sin((p.x - p.y) * 3.1 - t * 1.7) * 0.2;
    return vec3(nx, 0.0, nz) * 0.045;
  }

  void main() {
    vec3 n = normalize(vNormal + rippleNormal(vWorldPos.xz));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    float crest = smoothstep(-0.6, 0.9, vHeight);
    vec3 water = mix(uDeepColor, uShallowColor, crest * 0.6);

    float diffuse = max(dot(n, uSunDir), 0.0) * 0.35 + 0.65;
    vec3 color = water * diffuse;
    color = mix(color, uSkyColor, fresnel * 0.8);

    vec3 halfDir = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(n, halfDir), 0.0), 220.0) * 3.0;
    float glitter = pow(max(dot(n, halfDir), 0.0), 60.0) * 0.12;
    color += uSunColor * (spec + glitter);

    // Bọt trắng nhẹ trên đỉnh sóng.
    float foam = smoothstep(0.7, 1.0, vHeight) * 0.25;
    color = mix(color, vec3(0.95), foam);

    float dist = length(cameraPosition - vWorldPos);
    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Ocean {
  constructor(scene, { sunDir, fogColor, fogDensity }) {
    this.uniforms = {
      uTime: { value: 0 },
      uAmpScale: { value: 1 },
      uWaveA: { value: WAVES.map((w) => new THREE.Vector4(w.dir[0], w.dir[1], w.amp, w.k)) },
      uWaveB: { value: WAVES.map((w) => new THREE.Vector2(w.speed, w.phase)) },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      uDeepColor: { value: new THREE.Color(0x115079) },
      uShallowColor: { value: new THREE.Color(0x2a92a8) },
      uSkyColor: { value: new THREE.Color(0x9cc4e4) },
      uFogColor: { value: fogColor.clone() },
      uFogDensity: { value: fogDensity },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
    });

    // Lưới chi tiết đi theo camera (bước lưới cố định để sóng không bị "trượt").
    this.size = 1400;
    this.segments = 420;
    this.step = this.size / this.segments;
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Mặt phẳng phẳng rất lớn phía dưới để lấp kín tới chân trời.
    const farMat = material.clone();
    farMat.uniforms = { ...this.uniforms, uAmpScale: { value: 0 } };
    const farGeo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    farGeo.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(farGeo, farMat);
    this.far.position.y = -1.2;
    this.far.frustumCulled = false;
    scene.add(this.far);
  }

  update(time, focus) {
    this.uniforms.uTime.value = time;
    this.mesh.position.x = Math.round(focus.x / this.step) * this.step;
    this.mesh.position.z = Math.round(focus.z / this.step) * this.step;
    this.far.position.x = focus.x;
    this.far.position.z = focus.z;
  }

  getHeight(x, z, time = this.uniforms.uTime.value) {
    let h = 0;
    for (const w of WAVES) {
      h += w.amp * Math.sin(w.k * (w.dir[0] * x + w.dir[1] * z - w.speed * time) + w.phase);
    }
    return h;
  }
}
