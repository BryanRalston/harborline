import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ASSET_PATHS, DEFS } from "./buildings.js";
import { generateFallback, keyMagenta } from "./assets.js";
import {
  CELL,
  SIZE,
  cellToWorld,
  hash,
  idx,
  inBounds,
  neighborsRoad,
  shorelineZ,
  terrainHeight,
  tileAt,
} from "./city.js";
import { createLandMesh, createSeawallMesh } from "./terrain.js";
import { createPiers, createStreets, streetSetback } from "./streets.js";
import { isBuilt, makeConstruction, syncConstruction } from "./construction.js";
import { createBoat, createBuilding, createCar, createTree } from "./structure.js";
import { detectDevice } from "./device.js";

export const DEVICE = detectDevice();

let cachedLand = null;
let cachedWall = null;
let cachedWater = null;

const texLoader = new THREE.TextureLoader();
const textures = new Map();
const fallbacks = new Map();
const logged = new Set();
const buildingGroup = new THREE.Group();
const treeGroup = new THREE.Group();
const decoGroup = new THREE.Group();
const ghost = { mesh: null };

let renderer, scene, camera, controls, composer, bloom;
let sun, hemi, fill, waterMesh, clock, nightMap, pickPlane, skyMesh, skyMap;

function makeSkyDomeTexture() {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#355274");
  grd.addColorStop(0.34, "#5e84a8");
  grd.addColorStop(0.52, "#8eabc0");
  grd.addColorStop(0.64, "#d4b898");
  grd.addColorStop(0.76, "#e0b07a");
  grd.addColorStop(0.88, "#c4b094");
  grd.addColorStop(1, "#8a9698");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.2;
  g.fillStyle = "#f4eadc";
  for (let i = 0; i < 22; i++) {
    const x = (i * 173 + 40) % w;
    const y = 36 + ((i * 67) % 170);
    g.beginPath();
    g.ellipse(x, y, 90 + (i % 6) * 16, 9 + (i % 4) * 3, -0.28, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function logMissing(name) {
  if (logged.has(name)) return;
  logged.add(name);
  console.warn(`[harborline] missing texture, using placeholder: ${name}`);
}

function nameFromUrl(url) {
  const hit = Object.entries(ASSET_PATHS).find(([, p]) => p === url);
  return hit ? hit[0] : url;
}

function fallbackTex(name) {
  if (!fallbacks.has(name)) fallbacks.set(name, generateFallback(name));
  return fallbacks.get(name);
}

function loadTex(url, repeat) {
  const key = url + (repeat ? ":" + repeat.join("x") : "");
  if (textures.has(key)) return textures.get(key);
  const name = nameFromUrl(url);
  const tex = fallbackTex(name).clone();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.needsUpdate = true;
  textures.set(key, tex);
  texLoader.load(
    url,
    (loaded) => {
      let src = loaded;
      if (name.startsWith("oak") || name.startsWith("pine")) src = keyMagenta(loaded);
      tex.image = src.image;
      tex.source = src.source;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    },
    undefined,
    () => logMissing(name)
  );
  return tex;
}

function std(map, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: extra.roughness ?? 0.86,
    metalness: extra.metalness ?? 0.04,
    ...extra,
  });
}

export function createRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: DEVICE.antialias,
    powerPreference: DEVICE.quality === "low" ? "low-power" : "high-performance",
  });
  renderer.setPixelRatio(DEVICE.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.setClearColor(0x9eb0be, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ea8bc);
  scene.fog = new THREE.Fog(0xb7c2cc, 140, 520);

  camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 1.2, 2500);
  const shore = cellToWorld(20, Math.ceil(shorelineZ(20)));
  camera.position.set(shore.x - 14, 28, shore.z - 64);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.068;
  controls.minPolarAngle = 0.48;
  controls.maxPolarAngle = 1.22;
  controls.minDistance = 36;
  controls.maxDistance = 260;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.target.set(shore.x + 18, 6.5, shore.z + 24);
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);

  hemi = new THREE.HemisphereLight(0xd4c8b8, 0x3d3428, 0.74);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffb070, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(DEVICE.shadow, DEVICE.shadow);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 520;
  const d = 230;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.035;
  sun.target.position.set(0, 0, 20);
  scene.add(sun, sun.target);
  fill = new THREE.DirectionalLight(0xc4d4e8, 0.28);
  fill.position.set(80, 50, -40);
  scene.add(fill);

  skyMap = makeSkyDomeTexture();
  skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(620, 40, 24),
    new THREE.MeshBasicMaterial({
      map: skyMap,
      color: 0xffffff,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  skyMesh.name = "sky";
  skyMesh.rotation.y = 0.7;
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;
  scene.add(skyMesh);
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(268, 292, 64, 36, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9eb0be,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    })
  );
  haze.position.y = 10;
  haze.name = "haze";
  haze.frustumCulled = false;
  scene.add(haze);
  const envScene = new THREE.Scene();
  envScene.add(skyMesh.clone());
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(780, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: 0x6a5a48 })
  );
  envScene.add(ground);
  try {
    scene.environment = pmrem.fromScene(envScene, 0.08).texture;
    scene.environmentIntensity = 0.72;
  } catch {
    scene.environment = null;
  }
  pmrem.dispose();

  const pickGeo = new THREE.PlaneGeometry(SIZE * CELL, SIZE * CELL);
  pickGeo.rotateX(-Math.PI / 2);
  pickPlane = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
  scene.add(pickPlane);

  scene.add(buildingGroup);
  scene.add(treeGroup);
  scene.add(decoGroup);

  composer = null;
  bloom = null;
  clock = new THREE.Clock();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  return { renderer, scene, camera, controls };
}

export function invalidateTerrain() {
  cachedLand = null;
  cachedWall = null;
  cachedWater = null;
  waterMesh = null;
}

export function buildTerrain(city) {
  const old = scene.getObjectByName("terrain");
  if (old) scene.remove(old);
  const root = new THREE.Group();
  root.name = "terrain";

  if (!cachedLand) cachedLand = createLandMesh(loadTex);
  if (!cachedWall) cachedWall = createSeawallMesh(loadTex);
  if (!cachedWater) {
    cachedWater = makeWater();
    waterMesh = cachedWater;
  }
  root.add(cachedLand);
  root.add(cachedWall);
  root.add(cachedWater);
  root.add(createStreets(city, loadTex));
  root.add(createPiers(city, loadTex));
  addBoats(city, root);
  scene.add(root);
}

function addBoats(city, root) {
  const spots = [
    [18, Math.ceil(shorelineZ(18)) - 2, 0.15],
    [18, Math.ceil(shorelineZ(18)) - 3, 0.2],
    [18, Math.ceil(shorelineZ(18)) - 5, 0.05],
    [20, Math.ceil(shorelineZ(20)) - 2, -0.25],
    [13, Math.ceil(shorelineZ(13)) - 2, -0.4],
    [13, Math.ceil(shorelineZ(13)) - 4, -0.15],
    [22, Math.ceil(shorelineZ(22)) - 2, 0.35],
    [22, Math.ceil(shorelineZ(22)) - 4, 0.5],
    [16, 3, 0.6],
    [10, 5, -0.9],
    [26, 4, 1.4],
  ];
  for (const [x, z, yaw] of spots) {
    if (!inBounds(x, z)) continue;
    const t = tileAt(city, x, z);
    if (!t || (t.terrain !== "water" && t.kind !== "pier")) continue;
    const g = createBoat();
    const p = cellToWorld(x, z);
    g.position.set(p.x + 2.2, 0.02, p.z + 1.4);
    g.rotation.y = yaw;
    root.add(g);
  }
  addCrane(root, 12, Math.ceil(shorelineZ(13)) - 1);
}

function addCrane(root, x, z) {
  if (!inBounds(x, z)) return;
  const p = cellToWorld(x, z);
  const steel = new THREE.MeshStandardMaterial({ color: 0xb85a20, roughness: 0.45, metalness: 0.35 });
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.45, 18, 0.45), steel);
  mast.position.y = 9;
  mast.castShadow = true;
  const jib = new THREE.Mesh(new THREE.BoxGeometry(16, 0.32, 0.32), steel);
  jib.position.set(5.5, 16.4, 0);
  jib.castShadow = true;
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.55 })
  );
  cab.position.set(0.2, 15.4, 0);
  g.add(mast, jib, cab);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = 0.4;
  root.add(g);
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(SIZE * CELL + 80, SIZE * CELL + 80, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const map = loadTex(ASSET_PATHS["water.jpg"], [22, 22]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) },
      uSunColor: { value: new THREE.Color(0xffc49a) },
      uDeep: { value: new THREE.Color(0x123038) },
      uShallow: { value: new THREE.Color(0x2d6a68) },
      uSky: { value: new THREE.Color(0xc4cdd4) },
      uMap: { value: map },
      uCameraPos: { value: new THREE.Vector3() },
      uNight: { value: 0 },
    },
    transparent: true,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 0.07 + uTime * 0.55) * 0.1 + cos(p.z * 0.09 + uTime * 0.42) * 0.08;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform sampler2D uMap;
      uniform vec3 uCameraPos;
      uniform float uNight;
      void main() {
        vec2 uv = vUv * 22.0 + vec2(uTime * 0.01, uTime * 0.007);
        vec2 uv2 = vUv * 13.0 - vec2(uTime * 0.008, -uTime * 0.01);
        float n = sin(vWorldPos.x * 0.11 + uTime * 0.4) * cos(vWorldPos.z * 0.09 + uTime * 0.32);
        vec3 normal = normalize(vNormal + vec3(n * 0.1, 0.0, n * 0.08));
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        vec3 lightDir = normalize(uSunDir);
        float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.6);
        vec3 tex = texture2D(uMap, uv).rgb * 0.55 + texture2D(uMap, uv2).rgb * 0.45;
        vec3 waterCol = mix(uDeep, uShallow, 0.42 + n * 0.1);
        waterCol = mix(waterCol, tex, 0.4);
        vec3 color = mix(waterCol, mix(uSky, uSunColor, 0.4), fresnel * 0.88);
        vec3 halfV = normalize(lightDir + viewDir);
        color += uSunColor * pow(max(0.0, dot(normal, halfV)), 64.0) * 0.95 * (1.0 - uNight * 0.7);
        color += uSky * pow(max(0.0, dot(normal, halfV)), 12.0) * 0.12;
        color = mix(color, waterCol * 0.22 + vec3(0.015, 0.03, 0.05), uNight);
        float dist = length(uCameraPos - vWorldPos);
        color = mix(color, uSky, smoothstep(160.0, 520.0, dist) * 0.5);
        gl_FragColor = vec4(color, 0.94);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.16;
  mesh.receiveShadow = true;
  return mesh;
}

function buildingMesh(type, hScale = 1, tile = { x: 1, z: 1, hScale }) {
  if (!DEFS[type] || type === "road" || type === "pier") return new THREE.Group();
  return createBuilding(type, { ...tile, hScale }, loadTex, nightMap);
}

function scatterTrees(city) {
  treeGroup.clear();
  decoGroup.clear();
  const oak = loadTex(ASSET_PATHS["oak.png"]);
  const pine = loadTex(ASSET_PATHS["pine.png"]);
  oak.wrapS = oak.wrapT = THREE.ClampToEdgeWrapping;
  pine.wrapS = pine.wrapT = THREE.ClampToEdgeWrapping;

  const plant = (x, z, ox, oz, kind, sc) => {
    const t = tileAt(city, x, z);
    if (!t || t.terrain === "water") return;
    if (t.kind && t.kind !== "park" && t.kind !== "road") return;
    const tree = createTree(kind === "pine" ? pine : oak, sc);
    const p = cellToWorld(x, z);
    tree.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz), p.z + oz);
    tree.rotation.y = hash(x + ox, z + oz) * Math.PI;
    treeGroup.add(tree);
  };

  for (const t of city.tiles) {
    if (t.kind === "park" && isBuilt(t)) {
      const n = 7 + Math.floor(hash(t.x, t.z) * 4);
      for (let i = 0; i < n; i++) {
        const ox = (hash(t.x + i, t.z) - 0.5) * 5.6;
        const oz = (hash(t.x, t.z + i + 3) - 0.5) * 5.6;
        plant(t.x, t.z, ox, oz, hash(t.x * 2, i) > 0.62 ? "pine" : "oak", 8.4 + hash(i, t.z) * 2.8);
      }
    }
    if (t.kind === "road" && hash(t.x, t.z) > 0.55) {
      plant(t.x, t.z, (hash(t.x, 1) - 0.5) * 0.6, 3.55, "oak", 6.4);
    }
    if (!t.kind && t.terrain !== "water" && hash(t.x * 1.7, t.z * 2.1) > 0.58) {
      plant(t.x, t.z, (hash(t.x, 9) - 0.5) * 2, (hash(8, t.z) - 0.5) * 2, hash(t.z, t.x) > 0.5 ? "oak" : "pine", 6.8);
    }
    if (t.z >= SIZE - 5 && t.terrain !== "water" && hash(t.x * 2.2, t.z) > 0.28) {
      plant(t.x, t.z, (hash(t.x, 3) - 0.5) * 3.2, (hash(4, t.z) - 0.5) * 2.4, "oak", 8.2 + hash(t.x, t.z) * 3.4);
    }
    if (t.x >= SIZE - 4 && t.terrain !== "water" && hash(t.z * 1.8, t.x) > 0.34) {
      plant(t.x, t.z, (hash(2, t.x) - 0.5) * 2.2, (hash(t.z, 6) - 0.5) * 3.0, "pine", 7.6 + hash(t.z, 1) * 3);
    }
    if (t.kind === "road" && isBuilt(t) && hash(t.x * 4.2, t.z * 3.1) > 0.62) {
      const p = cellToWorld(t.x, t.z);
      const car = createCar(hash(t.x, t.z + 11));
      const along = neighborsRoad(city, t.x, t.z);
      car.position.set(p.x + (along.n || along.s ? 1.35 : 0), terrainHeight(p.x, p.z) + 0.02, p.z + (along.e || along.w ? 1.35 : 0));
      car.rotation.y = along.n || along.s ? 0 : Math.PI * 0.5;
      decoGroup.add(car);
    }
  }
}

export function rebuildCityMeshes(city) {
  buildingGroup.clear();
  for (const t of city.tiles) {
    if (!t.kind) continue;
    if ((t.kind === "road" || t.kind === "pier") && isBuilt(t)) continue;
    if (!isBuilt(t)) {
      const site = makeConstruction(t, loadTex);
      const p = cellToWorld(t.x, t.z);
      site.position.set(p.x, terrainHeight(p.x, p.z), p.z);
      if (t.facing) site.rotation.y = (t.facing * Math.PI) / 2;
      site.userData = { x: t.x, z: t.z, type: t.kind, construct: true };
      buildingGroup.add(site);
      continue;
    }
    if (t.kind === "road" || t.kind === "pier") continue;
    const mesh = buildingMesh(t.kind, t.hScale || 1, t);
    const p = cellToWorld(t.x, t.z);
    const sb = streetSetback(city, t);
    const jx = t.kind === "house" || t.kind === "park" ? 0 : (hash(t.x, t.z + 9) - 0.5) * 0.28;
    const jz = t.kind === "house" || t.kind === "park" ? 0 : (hash(t.z, t.x + 4) - 0.5) * 0.28;
    mesh.position.set(p.x + sb.ox + jx, terrainHeight(p.x, p.z), p.z + sb.oz + jz);
    if (t.facing) mesh.rotation.y = (t.facing * Math.PI) / 2;
    mesh.userData = { x: t.x, z: t.z, type: t.kind };
    buildingGroup.add(mesh);
  }
  scatterTrees(city);
}

export function setGhost(type, x, z, valid, facing = 0) {
  if (ghost.mesh) {
    scene.remove(ghost.mesh);
    ghost.mesh = null;
  }
  if (!type || x == null || !inBounds(x, z)) return;
  const mesh = buildingMesh(type, 1);
  mesh.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.42;
      c.depthWrite = false;
      c.color = new THREE.Color(valid ? 0x7dffa1 : 0xff6b6b);
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    o.castShadow = false;
  });
  const p = cellToWorld(x, z);
  mesh.position.set(p.x, terrainHeight(p.x, p.z) + 0.04, p.z);
  mesh.rotation.y = (facing || 0) * Math.PI * 0.5;
  scene.add(mesh);
  ghost.mesh = mesh;
}

export function setDayNight(hour24) {
  const h = ((hour24 % 24) + 24) % 24;
  const dawn = smooth(h, 5.2, 7.2);
  const dusk = 1 - smooth(h, 17.2, 19.6);
  const day = dawn * dusk;
  const night = 1 - day;

  const az = ((h - 6) / 12) * Math.PI;
  const elev = Math.max(Math.sin(((h - 6) / 12) * Math.PI), -0.12);
  sun.position.set(Math.cos(az) * 210, Math.max(elev, 0.02) * 150 + 8, Math.sin(az) * 70);
  const sunCol = new THREE.Color().setHSL(
    night > 0.7 ? 0.62 : THREE.MathUtils.lerp(0.07, 0.12, day),
    night > 0.7 ? 0.15 : THREE.MathUtils.lerp(0.55, 0.22, day),
    THREE.MathUtils.lerp(0.55, 0.92, day)
  );
  sun.color.copy(sunCol);
  sun.intensity = THREE.MathUtils.lerp(0.08, 2.75, Math.max(day, 0.04));
  hemi.color.set(night > 0.55 ? 0x3a4e72 : 0xd0dce8);
  hemi.groundColor.set(night > 0.55 ? 0x0c1016 : 0x4a4030);
  hemi.intensity = THREE.MathUtils.lerp(0.28, 0.82, day) + night * 0.28;
  fill.intensity = THREE.MathUtils.lerp(0.05, 0.38, day);

  const golden = day > 0.28 && day < 0.88;
  const fog = new THREE.Color().lerpColors(
    new THREE.Color(0x0b1020),
    new THREE.Color(golden ? 0xc5c8cc : 0xb4c2d0),
    day
  );
  scene.fog.color.copy(fog);
  const skyCol = new THREE.Color().lerpColors(
    new THREE.Color(0x0b1020),
    new THREE.Color(golden ? 0x9aafc0 : 0x8ea8bc),
    day
  );
  scene.background = skyCol;
  if (skyMesh?.material) {
    skyMesh.material.color.setScalar(THREE.MathUtils.lerp(0.22, 1, day));
  }
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.7, 1.14, day);
  if (bloom) bloom.strength = night * 0.32;

  if (waterMesh?.material?.uniforms?.uSunDir) {
    waterMesh.material.uniforms.uSunDir.value.copy(sun.position).normalize();
    waterMesh.material.uniforms.uSunColor.value.copy(sunCol);
    waterMesh.material.uniforms.uSky.value.copy(fog);
    waterMesh.material.uniforms.uNight.value = night;
  }

  const emit = night * 1.15;
  buildingGroup.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m && m.emissiveMap) m.emissiveIntensity = emit;
    }
  });
  scene.traverse((o) => {
    if (o.userData.lamp && o.material) o.material.emissiveIntensity = 0.2 + night * 1.4;
  });
}

function smooth(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function pickCell(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(pickPlane, false);
  const hit = hits[0];
  if (!hit) return null;
  const x = Math.round(hit.point.x / CELL + (SIZE - 1) / 2);
  const z = Math.round(hit.point.z / CELL + (SIZE - 1) / 2);
  if (!inBounds(x, z)) return null;
  return { x, z };
}

export function pickBuilding(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(buildingGroup.children, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj && (obj.userData.x == null)) obj = obj.parent;
  if (!obj || obj.userData.x == null) return null;
  return { x: obj.userData.x, z: obj.userData.z };
}

const focus = { active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1 };

export function updateBuildSites(city) {
  for (const g of buildingGroup.children) {
    if (!g.userData.construct) continue;
    const t = tileAt(city, g.userData.x, g.userData.z);
    if (t && t.kind) syncConstruction(g, t, loadTex);
  }
}

export function focusCell(x, z) {
  const p = cellToWorld(x, z);
  focus.to.set(p.x, 1.2, p.z);
  focus.from.copy(controls.target);
  focus.t = 0;
  focus.active = true;
}

export function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();
  if (focus.active) {
    focus.t = Math.min(1, focus.t + dt * 2.4);
    const e = focus.t * focus.t * (3 - 2 * focus.t);
    controls.target.lerpVectors(focus.from, focus.to, e);
    if (focus.t >= 1) focus.active = false;
  }
  if (waterMesh?.material?.uniforms?.uTime) {
    waterMesh.material.uniforms.uTime.value += dt;
    waterMesh.material.uniforms.uCameraPos.value.copy(camera.position);
  }
  const wind = clock.elapsedTime;
  for (let i = 0; i < treeGroup.children.length; i++) {
    treeGroup.children[i].rotation.z = Math.sin(wind * 0.55 + i * 0.7) * 0.028;
  }
  try {
    renderer.render(scene, camera);
  } catch (err) {
    console.error("[harborline] render", err);
  }
  return dt;
}

export function preload() {
  nightMap = loadTex(ASSET_PATHS["night_windows.jpg"]);
  const list = Object.values(ASSET_PATHS);
  return Promise.all(
    list.map(
      (u) =>
        new Promise((res) => {
          const t = loadTex(u);
          if (t.image && t.image.width) {
            res(t);
            return;
          }
          const start = performance.now();
          const id = setInterval(() => {
            if ((t.image && t.image.width) || performance.now() - start > 8000) {
              clearInterval(id);
              res(t);
            }
          }, 40);
        })
    )
  );
}

export { idx };
