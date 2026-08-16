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
let sun, hemi, fill, waterMesh, clock, nightMap, pickPlane;

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
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0xc4b49a, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aaebc);
  scene.fog = new THREE.FogExp2(0xb7c4ce, 0.00085);

  camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1.2, 2500);
  const pier = cellToWorld(18, Math.ceil(shorelineZ(18)));
  camera.position.set(pier.x - 38, 34, pier.z - 56);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.068;
  controls.minPolarAngle = 0.48;
  controls.maxPolarAngle = 1.22;
  controls.minDistance = 36;
  controls.maxDistance = 260;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.target.set(pier.x + 16, 3.2, pier.z + 22);
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);

  hemi = new THREE.HemisphereLight(0xb9d0e4, 0x3a2a1c, 0.62);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffc088, 2.35);
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

  const skyMap = loadTex(ASSET_PATHS["sky.jpg"]);
  skyMap.wrapS = skyMap.wrapT = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 20),
    new THREE.MeshBasicMaterial({
      map: skyMap,
      color: 0xc9b59a,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  sky.name = "sky";
  sky.frustumCulled = false;
  scene.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(780, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: 0x6a5a48 })
  );
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.06).texture;
  scene.environmentIntensity = 0.85;
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

function roadMesh(city, t) {
  const g = new THREE.Group();
  const p = cellToWorld(t.x, t.z);
  g.position.set(p.x, 0, p.z);
  const n = neighborsRoad(city, t.x, t.z);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(CELL, 0.1, CELL),
    std(loadTex(ASSET_PATHS["concrete.jpg"]), { roughness: 0.88 })
  );
  const gy = terrainHeight(p.x, p.z);
  slab.position.y = gy + 0.045;
  slab.receiveShadow = true;
  g.add(slab);
  const mid = new THREE.Mesh(
    new THREE.BoxGeometry(CELL * 0.62, 0.07, CELL * 0.62),
    std(loadTex(ASSET_PATHS["asphalt.jpg"]), { roughness: 0.8 })
  );
  mid.position.y = gy + 0.09;
  mid.receiveShadow = true;
  g.add(mid);
  const asph = std(loadTex(ASSET_PATHS["asphalt.jpg"]), { roughness: 0.8 });
  if (n.n) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.62, 0.08, CELL * 0.22), asph);
    a.position.set(0, gy + 0.09, CELL * 0.4);
    a.receiveShadow = true;
    g.add(a);
  }
  if (n.s) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.62, 0.08, CELL * 0.22), asph);
    a.position.set(0, gy + 0.09, -CELL * 0.4);
    a.receiveShadow = true;
    g.add(a);
  }
  if (n.e) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.22, 0.08, CELL * 0.62), asph);
    a.position.set(CELL * 0.4, gy + 0.09, 0);
    a.receiveShadow = true;
    g.add(a);
  }
  if (n.w) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.22, 0.08, CELL * 0.62), asph);
    a.position.set(-CELL * 0.4, gy + 0.09, 0);
    a.receiveShadow = true;
    g.add(a);
  }
  return g;
}

function pierMesh(t) {
  const g = new THREE.Group();
  const p = cellToWorld(t.x, t.z);
  g.position.set(p.x, 0, p.z);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(CELL * 0.9, 0.16, CELL * 0.9),
    std(loadTex(ASSET_PATHS["wood_dock.jpg"]), { roughness: 0.78 })
  );
  deck.position.y = 0.08;
  deck.castShadow = true;
  deck.receiveShadow = true;
  g.add(deck);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  for (const [ox, oz] of [
    [-2.6, -2.6],
    [2.6, -2.6],
    [-2.6, 2.6],
    [2.6, 2.6],
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 6), postMat);
    post.position.set(ox, -0.9, oz);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

function addBoats(city, root) {
  const spots = [
    [18, Math.ceil(shorelineZ(18)) - 3, 0.2],
    [13, Math.ceil(shorelineZ(13)) - 2, -0.4],
    [20, Math.ceil(shorelineZ(20)) - 4, 1.2],
    [16, 3, 0.6],
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
}

function addSeawalls(city, root) {
  const mat = std(loadTex(ASSET_PATHS["concrete.jpg"]), { roughness: 0.86, color: 0xd4cfc4 });
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const t of city.tiles) {
    if (t.terrain !== "sand" && t.terrain !== "concrete") continue;
    for (const [dx, dz] of dirs) {
      const n = tileAt(city, t.x + dx, t.z + dz);
      if (!n || n.terrain !== "water") continue;
      const p = cellToWorld(t.x, t.z);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(dx ? 0.28 : CELL, 0.7, dz ? 0.28 : CELL), mat);
      wall.position.set(p.x + dx * 3.7, 0.05, p.z + dz * 3.7);
      wall.castShadow = true;
      wall.receiveShadow = true;
      root.add(wall);
    }
  }
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(SIZE * CELL + 80, SIZE * CELL + 80, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const map = loadTex(ASSET_PATHS["water.jpg"], [22, 22]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) },
      uSunColor: { value: new THREE.Color(0xffc088) },
      uDeep: { value: new THREE.Color(0x082e38) },
      uShallow: { value: new THREE.Color(0x1b6a70) },
      uSky: { value: new THREE.Color(0xc9b59a) },
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
        vec3 waterCol = mix(uDeep, uShallow, 0.38 + n * 0.08);
        waterCol = mix(waterCol, tex, 0.48);
        vec3 color = mix(waterCol, mix(uSky, uSunColor, 0.28), fresnel * 0.7);
        vec3 halfV = normalize(lightDir + viewDir);
        color += uSunColor * pow(max(0.0, dot(normal, halfV)), 72.0) * 0.8 * (1.0 - uNight * 0.7);
        color = mix(color, waterCol * 0.22 + vec3(0.015, 0.03, 0.05), uNight);
        gl_FragColor = vec4(color, 0.94);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.22;
  mesh.receiveShadow = true;
  return mesh;
}

function makeWaterLegacy() {
  const geo = new THREE.PlaneGeometry(SIZE * CELL + 80, SIZE * CELL + 80, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const map = loadTex(ASSET_PATHS["water.jpg"], [28, 28]);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) },
      uSunColor: { value: new THREE.Color(0xffc088) },
      uDeep: { value: new THREE.Color(0x082e38) },
      uShallow: { value: new THREE.Color(0x1b6a70) },
      uSky: { value: new THREE.Color(0xc9b59a) },
      uMap: { value: map },
      uCameraPos: { value: new THREE.Vector3() },
      uNight: { value: 0 },
    },
    transparent: true,
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(p.x * 0.07 + uTime * 0.55) * 0.11 + cos(p.z * 0.09 + uTime * 0.42) * 0.09;
        vec3 n = normalize(normal + vec3(
          cos(p.x * 0.07 + uTime * 0.55) * 0.08,
          0.0,
          -sin(p.z * 0.09 + uTime * 0.42) * 0.08
        ));
        vNormal = normalize(mat3(modelMatrix) * n);
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
        vec2 uv = vUv * 26.0 + vec2(uTime * 0.011, uTime * 0.007);
        vec2 uv2 = vUv * 15.0 - vec2(uTime * 0.008, -uTime * 0.01);
        float n = sin(vWorldPos.x * 0.11 + uTime * 0.4) * cos(vWorldPos.z * 0.09 + uTime * 0.32);
        vec3 normal = normalize(vNormal + vec3(n * 0.1, 0.0, n * 0.08));
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        vec3 lightDir = normalize(uSunDir);
        float ndotv = max(0.0, dot(normal, viewDir));
        float fresnel = pow(1.0 - ndotv, 3.6);
        vec3 tex = texture2D(uMap, uv).rgb * 0.55 + texture2D(uMap, uv2).rgb * 0.45;
        vec3 waterCol = mix(uDeep, uShallow, 0.38 + n * 0.08);
        waterCol = mix(waterCol, tex, 0.5);
        vec3 reflectCol = mix(uSky, uSunColor, 0.28);
        vec3 color = mix(waterCol, reflectCol, fresnel * 0.74);
        vec3 halfV = normalize(lightDir + viewDir);
        float spec = pow(max(0.0, dot(normal, halfV)), 86.0);
        float spec2 = pow(max(0.0, dot(normal, halfV)), 18.0);
        color += uSunColor * (spec * 0.9 + spec2 * 0.12) * (1.0 - uNight * 0.7);
        color = mix(color, waterCol * 0.22 + vec3(0.015, 0.03, 0.05), uNight);
        gl_FragColor = vec4(color, 0.94);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.22;
  mesh.receiveShadow = true;
  return mesh;
}

function buildingMesh(type, hScale = 1, tile = { x: 1, z: 1, hScale }) {
  if (!DEFS[type] || type === "road") return new THREE.Group();
  if (type === "pier") return pierMesh({ x: 0, z: 0 });
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
    if (!t.kind && t.terrain === "grass" && hash(t.x * 1.7, t.z * 2.1) > 0.84) {
      plant(t.x, t.z, (hash(t.x, 9) - 0.5) * 2, (hash(8, t.z) - 0.5) * 2, hash(t.z, t.x) > 0.5 ? "oak" : "pine", 6.8);
    }
    if (t.kind === "road" && isBuilt(t) && hash(t.x * 4.2, t.z * 3.1) > 0.72) {
      const p = cellToWorld(t.x, t.z);
      const car = createCar(hash(t.x, t.z + 11));
      const along = neighborsRoad(city, t.x, t.z);
      car.position.set(p.x + (along.n || along.s ? 1.35 : 0), terrainHeight(p.x, p.z) + 0.02, p.z + (along.e || along.w ? 1.35 : 0));
      car.rotation.y = along.n || along.s ? 0 : Math.PI * 0.5;
      decoGroup.add(car);
    }
  }
}

function addLamp(t) {
  const p = cellToWorld(t.x, t.z);
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.55, metalness: 0.4 })
  );
  pole.position.y = 2.3;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc070, emissiveIntensity: 0.2 })
  );
  bulb.position.y = 4.4;
  bulb.userData.lamp = true;
  g.add(pole, bulb);
  g.position.set(p.x + 2.8, terrainHeight(p.x + 2.8, p.z + 2.8), p.z + 2.8);
  decoGroup.add(g);
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
  sun.intensity = THREE.MathUtils.lerp(0.08, 2.4, Math.max(day, 0.04));
  hemi.color.set(night > 0.55 ? 0x3a4e72 : 0xb9d0e4);
  hemi.groundColor.set(night > 0.55 ? 0x0c1016 : 0x3a2a1c);
  hemi.intensity = THREE.MathUtils.lerp(0.22, 0.62, day) + night * 0.28;
  fill.intensity = THREE.MathUtils.lerp(0.04, 0.28, day);

  const fog = new THREE.Color().lerpColors(
    new THREE.Color(0x0b1020),
    new THREE.Color(day > 0.35 && day < 0.85 ? 0xc9b59a : 0xb7c6d4),
    day
  );
  scene.fog.color.copy(fog);
  scene.background.copy(fog);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.68, 1.1, day);
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
