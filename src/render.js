import * as THREE from "three";
import { MOUSE, TOUCH } from "three";
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
  isInfra,
  isPaved,
  neighborsRoad,
  shorelineZ,
  shorelineWorldZ,
  terrainHeight,
  tileAt,
  worldToCell,
} from "./city.js";
import { createLandMesh, createSeawallMesh } from "./terrain.js";
import { createPiers, createStreets, streetSetback } from "./streets.js";
import { isBuilt, makeConstruction, syncConstruction } from "./construction.js";
import { createBoat, createBuilding, createCar, createPerson, createTree } from "./structure.js";
import { detectDevice, GFX_TIERS, setGfxPref } from "./device.js";
import { overlaySample } from "./economy.js";

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
const boatGroup = new THREE.Group();
const overlayGroup = new THREE.Group();
const drivers = [];
const signals = [];
const nightGlass = [];
const lamps = [];
const _worldA = { x: 0, y: 0, z: 0 };
const _worldB = { x: 0, y: 0, z: 0 };
const _sunCol = new THREE.Color();
const _fogA = new THREE.Color(0x0b1020);
const _fogB = new THREE.Color();
const _fog = new THREE.Color();
let overlayMode = null;
const ghost = { mesh: null };
const rangeHalo = { mesh: null, key: "" };
let shadowTick = 0;
let poorFrames = 0;
let lastFps = 60;
let gfxHook = null;

let renderer, scene, camera, controls, composer, bloom;
let sun, hemi, fill, waterMesh, clock, nightMap, pickPlane, skyMesh, skyMap, sunGlow, hazeMesh;

function disposeLoose(root, skip = []) {
  if (!root) return;
  const skipSet = new Set(skip);
  const seenG = new Set();
  const seenM = new Set();
  root.traverse((o) => {
    if (skipSet.has(o)) return;
    for (let p = o.parent; p; p = p.parent) {
      if (skipSet.has(p)) return;
    }
    if (o.geometry && !o.geometry.userData?.shared && !seenG.has(o.geometry)) {
      seenG.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!m || m.userData?.shared || seenM.has(m)) continue;
      seenM.add(m);
      if (m.map && m.map.userData?.cloned) m.map.dispose();
      if (m.emissiveMap && m.emissiveMap.userData?.cloned) m.emissiveMap.dispose();
      m.dispose();
    }
  });
}

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

function cloneCanvasTex(src) {
  const tex = src.clone();
  const img = src.image;
  if (img && typeof img.getContext === "function") {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    tex.image = c;
  }
  return tex;
}

function loadTex(url, repeat) {
  if (!url) {
    logMissing("undefined");
    return fallbackTex("undefined");
  }
  const key = url + (repeat ? ":" + repeat.join("x") : "");
  if (textures.has(key)) return textures.get(key);
  const name = nameFromUrl(url);
  const tex = cloneCanvasTex(fallbackTex(name));
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
      if (/^(oak|pine|maple|shrub)/.test(name)) src = keyMagenta(loaded);
      const canvas = tex.image;
      const img = src.image;
      if (canvas && typeof canvas.getContext === "function" && img) {
        const g = canvas.getContext("2d");
        g.clearRect(0, 0, canvas.width, canvas.height);
        try {
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch {
          /* tainted */
        }
        tex.needsUpdate = true;
      }
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

function phoneCamera() {
  return DEVICE.touch || DEVICE.phone || innerWidth <= 820;
}

function applyCameraButtons() {
  if (!controls) return;
  if (phoneCamera()) {
    controls.mouseButtons.LEFT = MOUSE.PAN;
    controls.mouseButtons.MIDDLE = MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = MOUSE.ROTATE;
    controls.touches.ONE = TOUCH.PAN;
    controls.touches.TWO = TOUCH.DOLLY_ROTATE;
    controls.rotateSpeed = 1.05;
  } else {
    controls.mouseButtons.LEFT = -1;
    controls.mouseButtons.MIDDLE = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.ROTATE;
    controls.touches.ONE = TOUCH.PAN;
    controls.touches.TWO = TOUCH.DOLLY_ROTATE;
    controls.rotateSpeed = 0.72;
  }
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
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    window.__harborLost = true;
    document.getElementById("gfx-fail")?.removeAttribute("hidden");
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    window.__harborLost = false;
    document.getElementById("gfx-fail")?.setAttribute("hidden", "");
    try {
      if (DEVICE.pref === "auto") Object.assign(DEVICE, GFX_TIERS.low, { quality: "low", pref: "auto" });
      renderer.setPixelRatio(Math.min(DEVICE.pixelRatio, 0.75));
      renderer.setSize(innerWidth, innerHeight);
      gfxHook?.("restore");
    } catch {
      /* ignore */
    }
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7a92a8);
  scene.fog = new THREE.Fog(0xc4b8a6, 120, 480);

  camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1.2, 2500);
  const dock = cellToWorld(18, Math.ceil(shorelineZ(18)));
  const phoneCam = DEVICE.phone || innerWidth <= 820;
  if (phoneCam) camera.position.set(dock.x - 16, 42, dock.z - 30);
  else camera.position.set(dock.x - 16, 36, dock.z - 52);

  const capture = canvas.setPointerCapture.bind(canvas);
  const release = canvas.releasePointerCapture.bind(canvas);
  canvas.setPointerCapture = (id) => {
    try {
      capture(id);
    } catch {
      /* stale or synthetic pointer — do not take the view down */
    }
  };
  canvas.releasePointerCapture = (id) => {
    try {
      release(id);
    } catch {
      /* ignore */
    }
  };
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 1.42;
  controls.minDistance = 10;
  controls.maxDistance = 420;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 1.15;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 1.15;
  applyCameraButtons();
  controls.keys = { LEFT: "KeyA", UP: "KeyW", RIGHT: "KeyD", BOTTOM: "KeyS" };
  controls.listenToKeyEvents(window);
  controls.target.set(dock.x, 2.4, dock.z);
  controls.update();
  window.__harbor = {
    lookCell(x, z, height = 28, back = 54) {
      const p = cellToWorld(x, z);
      controls.target.set(p.x, 2.4, p.z);
      camera.position.set(p.x - 16, height, p.z - back);
      controls.update();
    },
    trees: () => treeGroup.children.length,
    boats: () => boatGroup.children.length,
    lookAlong(x, z, axis = "z") {
      const p = cellToWorld(x, z);
      controls.target.set(p.x, 0.5, p.z);
      if (axis === "z") camera.position.set(p.x + 5.5, 7.2, p.z - 20);
      else camera.position.set(p.x - 20, 7.2, p.z + 5.5);
      controls.update();
    },
    rangeHalo: () => !!rangeHalo.mesh,
    ghostRing: () => !!(ghost.mesh && ghost.mesh.children.some((c) => c.geometry?.type === "RingGeometry")),
    overlay: () => overlayMode,
    gfx: () => DEVICE.quality,
    lights() {
      let ownedOn = 0;
      let ownedOff = 0;
      for (const m of nightGlass) {
        if (!m?.userData?.nightOwned) continue;
        if (m.userData.lit === false) ownedOff += 1;
        else ownedOn += 1;
      }
      return {
        lamps: lamps.length,
        glass: nightGlass.length,
        emit: nightGlass[0]?.emissiveIntensity || 0,
        ownedOn,
        ownedOff,
        lost: !!window.__harborLost,
      };
    },
    perf() {
      const info = renderer.info;
      return {
        quality: DEVICE.quality,
        fps: lastFps,
        calls: info.render.calls,
        tris: info.render.triangles,
        trees: treeGroup.children.length,
        movers: drivers.length,
        people: DEVICE.people,
        walkers: drivers.filter((d) => d.userData?.drive?.walk).length,
      };
    },
    traffic() {
      const rows = [];
      for (const car of decoGroup.children) {
        const d = car.userData.drive;
        if (!d) continue;
        const dx = d.nx - d.cx;
        const dz = d.nz - d.cz;
        const want = yawAlong(dx, dz);
        let err = car.rotation.y - want;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        rows.push({
          axis: Math.abs(dx) >= Math.abs(dz) ? "x" : "z",
          yaw: +car.rotation.y.toFixed(3),
          want: +want.toFixed(3),
          err: +Math.abs(err).toFixed(3),
        });
      }
      return {
        n: rows.length,
        maxErr: rows.reduce((m, r) => Math.max(m, r.err), 0),
        meanErr: rows.length ? rows.reduce((s, r) => s + r.err, 0) / rows.length : 0,
        sample: rows.slice(0, 8),
      };
    },
  };

  const pmrem = new THREE.PMREMGenerator(renderer);

  hemi = new THREE.HemisphereLight(0xffd2a8, 0x2a241c, 0.55);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xff9a4a, 3.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(DEVICE.shadow, DEVICE.shadow);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 340;
  const d = 140;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.035;
  sun.target.position.set(0, 0, 20);
  scene.add(sun, sun.target);
  fill = new THREE.DirectionalLight(0xffb070, 0.45);
  fill.position.set(80, 40, -40);
  scene.add(fill);
  const glowMat = new THREE.SpriteMaterial({
    color: 0xffc078,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  sunGlow = new THREE.Sprite(glowMat);
  sunGlow.scale.set(38, 38, 1);
  sunGlow.renderOrder = -900;
  scene.add(sunGlow);

  skyMap = loadTex(ASSET_PATHS["sky.jpg"]);
  skyMap.wrapS = skyMap.wrapT = THREE.ClampToEdgeWrapping;
  skyMap.mapping = THREE.EquirectangularReflectionMapping;
  skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(720, 48, 28),
    new THREE.MeshBasicMaterial({
      map: skyMap,
      color: 0xffffff,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      depthTest: false,
    })
  );
  skyMesh.name = "sky";
  skyMesh.rotation.y = 1.15;
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
  hazeMesh = haze;
  scene.add(haze);
  const envScene = new THREE.Scene();
  envScene.add(skyMesh.clone());
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(780, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: 0x6a5a48 })
  );
  envScene.add(ground);
  try {
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 1.05;
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
  scene.add(boatGroup);
  overlayGroup.renderOrder = 2;
  scene.add(overlayGroup);

  composer = null;
  bloom = null;
  clock = new THREE.Clock();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(DEVICE.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    applyCameraButtons();
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
  if (old) {
    const keep = [cachedLand, cachedWall, cachedWater].filter(Boolean);
    for (const k of keep) old.remove(k);
    disposeLoose(old);
    scene.remove(old);
  }
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
  const thinLamps = DEVICE.phone || DEVICE.quality === "low";
  root.add(createStreets(city, loadTex, thinLamps));
  root.add(createPiers(city, loadTex, thinLamps));
  addBoats(city, root);
  scene.add(root);
  collectLights();
}

function addBoats(city, root) {
  let piers = 0;
  for (const t of city.tiles) {
    if (t.kind !== "pier" || !isBuilt(t)) continue;
    piers += 1;
    if (t.shoreline || t.terrain !== "water") continue;
    const alongZ =
      tileAt(city, t.x, t.z + 1)?.kind === "pier" || tileAt(city, t.x, t.z - 1)?.kind === "pier";
    const p = cellToWorld(t.x, t.z);
    const boat = createBoat(hash(t.x, t.z + 3), hash(t.x, t.z) > 0.48 ? "work" : "skiff");
    const side = hash(t.x + 4, t.z) > 0.5 ? 1 : -1;
    if (alongZ) {
      boat.position.set(p.x + side * 5.35, 0.04, p.z);
      boat.rotation.y = Math.PI * 0.5;
    } else {
      boat.position.set(p.x, 0.04, p.z + side * 5.35);
      boat.rotation.y = 0;
    }
    root.add(boat);
    if (hash(t.x, t.z + 9) > 0.4) {
      const person = createPerson(hash(t.x, t.z + 11), true);
      person.position.set(p.x + (hash(t.x, 1) - 0.5) * 2.4, 0.48, p.z + (hash(2, t.z) - 0.5) * 2.4);
      person.rotation.y = hash(t.x, t.z) * Math.PI * 2;
      root.add(person);
    }
  }
  boatGroup.clear();
  const nSail = Math.min(5, 2 + Math.floor(piers * 0.5));
  for (let i = 0; i < nSail; i++) {
    const boat = createBoat(hash(i + 2, 9), "sail");
    boat.userData.sail = {
      x: 7 + (i % 2) * 17 + Math.floor(i / 2) * 2.2,
      dir: i % 2 ? 1 : -1,
      spd: 1.35 + hash(i, 4) * 1.1,
      off: 12 + hash(i, 2) * 7,
    };
    boatGroup.add(boat);
  }
  let yards = 0;
  for (const t of city.tiles) {
    if ((t.kind === "warehouse" || t.kind === "factory") && isBuilt(t)) yards += 1;
  }
  if (yards >= 2) addCrane(root, 12, Math.ceil(shorelineZ(13)) - 1);
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
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), steel);
  hook.position.set(12.2, 12.4, 0);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.04, 4.2, 0.04), steel);
  cable.position.set(12.2, 14.4, 0);
  g.add(mast, jib, cab, hook, cable);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = 0.4;
  root.add(g);
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(SIZE * CELL + 120, SIZE * CELL + 120, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.22, 0.18) },
      uSunColor: { value: new THREE.Color(0xff9a4a) },
      uDeep: { value: new THREE.Color(0x0a2a32) },
      uShallow: { value: new THREE.Color(0x4a7068) },
      uSky: { value: new THREE.Color(0xe0b888) },
      uCameraPos: { value: new THREE.Vector3() },
      uNight: { value: 0 },
    },
    transparent: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uCameraPos;
      uniform float uNight;
      void main() {
        vec3 viewDir = normalize(uCameraPos - vWorldPos);
        float ndv = max(0.0, dot(vec3(0.0, 1.0, 0.0), viewDir));
        float fresnel = pow(1.0 - ndv, 5.0);
        float shore = smoothstep(2.2, 0.05, abs(vWorldPos.y + 0.05));
        vec3 harbor = vec3(0.07, 0.15, 0.16);
        vec3 silt = vec3(0.28, 0.32, 0.24);
        vec3 waterCol = mix(harbor, silt, shore * 0.55);
        vec3 color = mix(waterCol, mix(uSky, uSunColor, 0.22), fresnel * 0.28);
        color = mix(color, waterCol * 0.18, uNight);
        float foam = pow(shore, 2.4);
        color += vec3(0.78, 0.82, 0.8) * foam * 0.18;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.12;
  mesh.receiveShadow = true;
  return mesh;
}

function buildingMesh(type, hScale = 1, tile = { x: 1, z: 1, hScale }) {
  if (!DEFS[type] || isInfra(type) || type === "bulldoze") return new THREE.Group();
  return createBuilding(type, { ...tile, hScale }, loadTex, nightMap);
}

function treePlates() {
  const clamp = (tex) => {
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  };
  return {
    oak: {
      side: clamp(loadTex(ASSET_PATHS["oak.jpg"])),
      crown: clamp(loadTex(ASSET_PATHS["oak_top.jpg"])),
      leaves: loadTex(ASSET_PATHS["leaves.jpg"], [3, 3]),
    },
    pine: {
      side: clamp(loadTex(ASSET_PATHS["pine.jpg"])),
      crown: clamp(loadTex(ASSET_PATHS["pine_top.jpg"])),
      leaves: loadTex(ASSET_PATHS["needles.jpg"], [3, 3]),
      needles: loadTex(ASSET_PATHS["needles.jpg"], [3, 3]),
    },
    maple: {
      side: clamp(loadTex(ASSET_PATHS["maple.jpg"])),
      crown: clamp(loadTex(ASSET_PATHS["maple_top.jpg"])),
      leaves: loadTex(ASSET_PATHS["leaves.jpg"], [3, 3]),
    },
    shrub: {
      side: clamp(loadTex(ASSET_PATHS["shrub.jpg"])),
      leaves: loadTex(ASSET_PATHS["leaves.jpg"], [3, 3]),
    },
  };
}

function scatterTrees(city) {
  trafficCity = city;
  disposeLoose(treeGroup);
  disposeLoose(decoGroup);
  treeGroup.clear();
  decoGroup.clear();
  drivers.length = 0;
  signals.length = 0;
  const plates = treePlates();
  const pick = (x, z, pineBias = 0.35) => {
    const h = hash(x, z);
    if (h < pineBias) return "pine";
    if (h < pineBias + 0.38) return "maple";
    return "oak";
  };

  const plant = (x, z, ox, oz, kind, sc, extra = {}) => {
    const t = tileAt(city, x, z);
    if (!t || t.terrain === "water") return;
    if (!extra.yard && t.kind && t.kind !== "park" && !isPaved(t.kind)) return;
    const tree = createTree(kind, sc, hash(x + ox * 3, z + oz * 2), plates[kind] || plates.oak, {
      quality: DEVICE.quality,
      pit: extra.pit,
    });
    const p = cellToWorld(x, z);
    tree.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz), p.z + oz);
    tree.rotation.y = hash(x + ox, z + oz) * Math.PI;
    if (!DEVICE.sway) {
      tree.updateMatrix();
      tree.matrixAutoUpdate = false;
    }
    treeGroup.add(tree);
  };

  for (const t of city.tiles) {
    if (t.kind === "park" && isBuilt(t)) {
      const n = (DEVICE.quality === "low" ? 2 : 3) + Math.floor(hash(t.x, t.z) * (DEVICE.trees > 0.6 ? 2 : 1));
      for (let i = 0; i < n; i++) {
        const ox = (hash(t.x + i, t.z) - 0.5) * 5.4;
        const oz = (hash(t.x, t.z + i + 3) - 0.5) * 5.4;
        if (Math.abs(ox) < 1.1 && Math.abs(oz) < 1.1) continue;
        plant(t.x, t.z, ox, oz, pick(t.x + i, t.z, 0.22), 5.2 + hash(i, t.z) * 1.6);
      }
      if (hash(t.x, t.z + 19) > 0.45) {
        plant(t.x, t.z, 2.4, 2.1, "shrub", 2.2 + hash(t.z, 2) * 0.5);
      }
    }
    if (isPaved(t.kind) && isBuilt(t) && !t.shoreline && hash(t.x, t.z) > 0.78) {
      const along = neighborsRoad(city, t.x, t.z);
      const ns = along.n || along.s;
      const ew = along.e || along.w;
      if (!(ns && ew)) {
        const side = hash(t.x, 3) > 0.5 ? 1 : -1;
        const ox = ns ? side * 3.45 : (hash(t.x, 1) - 0.5) * 0.3;
        const oz = ew ? side * 3.45 : (hash(t.z, 2) - 0.5) * 0.3;
        plant(t.x, t.z, ox, oz, hash(t.x, t.z + 4) > 0.42 ? "maple" : "oak", 5.2 + hash(t.z, t.x) * 1.1, {
          pit: true,
        });
      }
    }
    if (t.kind === "house" && isBuilt(t)) {
      if (hash(t.x, t.z + 17) > 0.58) {
        const side = hash(t.x, 3) > 0.5 ? 2.55 : -2.45;
        plant(t.x, t.z, side, -1.85, pick(t.x, t.z + 8, 0.12), 5.1 + hash(1, t.z) * 1.5, { yard: true });
      }
      if (hash(t.x * 2, t.z + 5) > 0.62) {
        plant(t.x, t.z, -2.35, 2.35, "shrub", 1.9 + hash(t.z, 2) * 0.55, { yard: true });
      }
    }
    if (!t.kind && t.terrain !== "water" && hash(t.x * 1.7, t.z * 2.1) > 0.9 + (1 - DEVICE.trees) * 0.08) {
      plant(t.x, t.z, (hash(t.x, 9) - 0.5) * 2, (hash(8, t.z) - 0.5) * 2, pick(t.z, t.x, 0.4), 5.8 + hash(t.x, 4) * 1.5);
    }
    if (t.z >= SIZE - 5 && t.terrain !== "water" && hash(t.x * 2.2, t.z) > 0.64 + (1 - DEVICE.trees) * 0.24) {
      plant(
        t.x,
        t.z,
        (hash(t.x, 3) - 0.5) * 3.2,
        (hash(4, t.z) - 0.5) * 2.4,
        pick(t.x, t.z + 2, 0.5),
        8.2 + hash(t.x, t.z) * 4.4,
        { yard: true }
      );
    }
    if (t.x >= SIZE - 4 && t.terrain !== "water" && hash(t.z * 1.8, t.x) > 0.58 + (1 - DEVICE.trees) * 0.26) {
      plant(
        t.x,
        t.z,
        (hash(2, t.x) - 0.5) * 2.2,
        (hash(t.z, 6) - 0.5) * 3.0,
        pick(t.z, t.x, 0.48),
        8 + hash(t.z, 1) * 3.8,
        { yard: true }
      );
    }
    const jam = t.traffic || 0;
    const hour = ((city.time % 24) + 24) % 24;
    const commute = (hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 18.5);
    const night = hour < 5.5 || hour >= 22;
    const thresh = jam > 3 ? 0.28 : commute ? 0.4 : night ? 0.74 : 0.56;
    const tAdj = thresh + (1 - thresh) * (1 - DEVICE.traffic);
    if (isPaved(t.kind) && isBuilt(t) && hash(t.x * 4.2, t.z * 3.1) > tAdj) {
      const steps = roadSteps(city, t.x, t.z);
      if (steps.length) {
        const pick = steps[Math.floor(hash(t.z, t.x + 3) * steps.length) % steps.length];
        let freight = false;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const n = tileAt(city, t.x + dx, t.z + dz);
          if (n && (n.kind === "factory" || n.kind === "warehouse") && isBuilt(n)) freight = true;
        }
        const along = neighborsRoad(city, t.x, t.z);
        if (!((along.n || along.s) && (along.e || along.w))) {
          const bus = jam > 2.4 && hash(t.x, t.z + 41) > 0.82;
          const car = createCar(hash(t.x, t.z + 11), freight && hash(t.x, t.z + 7) > 0.4 ? "truck" : bus ? "bus" : "car");
          const drive = {
            cx: t.x,
            cz: t.z,
            nx: t.x + pick[0],
            nz: t.z + pick[1],
            u: hash(t.x, t.z) * 0.85,
            base: Math.max(1.6, 6.1 - jam * 0.85),
            salt: 0,
            lane: 1.05,
          };
          placeCarOnSeg(car, city, drive);
          decoGroup.add(car);
          drivers.push(car);
        }
      }
    }
    const peopleCut =
      (commute ? 0.58 : night ? 0.9 : 0.76) + (1 - DEVICE.people) * 0.22;
    const streetCut =
      DEVICE.phone || DEVICE.quality === "low"
        ? Math.min(peopleCut, commute ? 0.4 : night ? 0.7 : 0.5)
        : peopleCut;
    if (
      isPaved(t.kind) &&
      isBuilt(t) &&
      DEVICE.people > 0 &&
      !((neighborsRoad(city, t.x, t.z).n || neighborsRoad(city, t.x, t.z).s) &&
        (neighborsRoad(city, t.x, t.z).e || neighborsRoad(city, t.x, t.z).w)) &&
      hash(t.x * 5.1, t.z * 2.2) > streetCut
    ) {
      const steps = roadSteps(city, t.x, t.z);
      if (steps.length) {
        const pick = steps[Math.floor(hash(t.z + 8, t.x) * steps.length) % steps.length];
        const person = createPerson(hash(t.x, t.z + 19));
        placeCarOnSeg(person, city, {
          cx: t.x,
          cz: t.z,
          nx: t.x + pick[0],
          nz: t.z + pick[1],
          u: hash(t.x + 2, t.z) * 0.85,
          base: 1.35 + hash(t.z, t.x) * 0.5,
          salt: 0,
          lane: 3.18,
          walk: true,
        });
        decoGroup.add(person);
        drivers.push(person);
      }
    }
    if (
      DEVICE.people > 0 &&
      isBuilt(t) &&
      (t.kind === "house" || t.kind === "shop" || t.kind === "office" || t.kind === "market") &&
      hash(t.x * 2.9, t.z * 6.1) > 0.42
    ) {
      const n = neighborsRoad(city, t.x, t.z);
      const dir = n.e ? [1, 0] : n.w ? [-1, 0] : n.n ? [0, -1] : n.s ? [0, 1] : null;
      if (dir) {
        const rx = t.x + dir[0];
        const rz = t.z + dir[1];
        const steps = roadSteps(city, rx, rz);
        if (steps.length) {
          const pick = steps[Math.floor(hash(t.z + 4, t.x) * steps.length) % steps.length];
          const stoop = createPerson(hash(t.x, t.z + 27), t.kind === "shop" || t.kind === "market");
          placeCarOnSeg(stoop, city, {
            cx: rx,
            cz: rz,
            nx: rx + pick[0],
            nz: rz + pick[1],
            u: 0.28 + hash(t.x, t.z) * 0.4,
            base: 1.12,
            salt: 0,
            lane: 3.18,
            walk: true,
          });
          decoGroup.add(stoop);
          drivers.push(stoop);
        }
      }
    }
    if (
      isPaved(t.kind) &&
      isBuilt(t) &&
      t.shoreline &&
      DEVICE.people > 0.3 &&
      hash(t.x * 2.8, t.z * 4.1) > 0.48
    ) {
      const steps = roadSteps(city, t.x, t.z);
      if (steps.length) {
        const pick = steps[Math.floor(hash(t.x + 1, t.z + 6) * steps.length) % steps.length];
        const tourist = createPerson(hash(t.x, t.z + 33), true);
        placeCarOnSeg(tourist, city, {
          cx: t.x,
          cz: t.z,
          nx: t.x + pick[0],
          nz: t.z + pick[1],
          u: hash(t.x, t.z + 5) * 0.85,
          base: 1.15,
          salt: 0,
          lane: 3.18,
          walk: true,
        });
        decoGroup.add(tourist);
        drivers.push(tourist);
      }
    }
    if (isPaved(t.kind) && isBuilt(t) && !t.shoreline) {
      const along = neighborsRoad(city, t.x, t.z);
      const arms = (along.n ? 1 : 0) + (along.s ? 1 : 0) + (along.e ? 1 : 0) + (along.w ? 1 : 0);
      if (arms >= 3 && hash(t.x * 1.3, t.z) > 0.4) {
        const p = cellToWorld(t.x, t.z);
        const sig = arms === 4 ? makeSignal() : makeStopSign();
        sig.position.set(p.x + 3.45, terrainHeight(p.x, p.z), p.z + 3.45);
        decoGroup.add(sig);
        if (arms === 4) signals.push(sig);
      }
    }
    if ((t.kind === "shop" || t.kind === "apartment" || t.kind === "hospital") && isBuilt(t) && hash(t.x, t.z + 21) > 0.4) {
      const n = neighborsRoad(city, t.x, t.z);
      const roads = (n.n ? 1 : 0) + (n.s ? 1 : 0) + (n.e ? 1 : 0) + (n.w ? 1 : 0);
      if (roads < 2) {
        const p = cellToWorld(t.x, t.z);
        const ox = n.e ? -4.15 : n.w ? 4.15 : n.n || n.s ? 2.05 : 2.2;
        const oz = n.n ? -4.15 : n.s ? 4.15 : n.e || n.w ? 2.05 : 2.05;
        const cell = worldToCell(p.x + ox, p.z + oz);
        const under = tileAt(city, cell.x, cell.z);
        if (!under || isPaved(under.kind) || under.kind === "pier") {
          /* keep cars in the lot, off the walk */
        } else {
          const car = createCar(hash(t.x + 3, t.z));
          car.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz) + 0.02, p.z + oz);
          car.rotation.y = yawToRoad(city, t.x, t.z);
          decoGroup.add(car);
        }
      }
    }
    if (t.shoreline && t.terrain !== "water" && !isPaved(t.kind) && DEVICE.quality !== "low" && !DEVICE.phone) {
      const p = cellToWorld(t.x, t.z);
      const nR = 1 + Math.floor(hash(t.x, t.z + 4) * 2);
      for (let i = 0; i < nR; i++) {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.22 + hash(t.x + i, t.z) * 0.38, 0),
          new THREE.MeshStandardMaterial({ color: 0x6a6460, roughness: 0.92 })
        );
        rock.position.set(
          p.x + (hash(t.x, 2 + i) - 0.5) * 4.2,
          terrainHeight(p.x, p.z) + 0.1,
          p.z + (hash(3 + i, t.z) - 0.5) * 3.2
        );
        rock.rotation.set(hash(t.x, 1 + i), hash(t.z, 2), hash(t.x, t.z + i));
        rock.castShadow = true;
        decoGroup.add(rock);
      }
      if (hash(t.x * 2.1, t.z) > 0.4) {
        const tuft = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0x3a5228 })
        );
        tuft.scale.set(1.3, 0.4, 1);
        tuft.position.set(p.x + (hash(8, t.x) - 0.5) * 2.4, terrainHeight(p.x, p.z) + 0.1, p.z + 1.2);
        decoGroup.add(tuft);
      }
      if (hash(t.x * 1.3, t.z * 4.4) > 0.72) {
        const log = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.09, 1.15, 5),
          new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.92 })
        );
        log.rotation.z = 1.15;
        log.rotation.y = hash(t.z, t.x) * Math.PI;
        log.position.set(p.x + 0.6, terrainHeight(p.x, p.z) + 0.08, p.z - 0.4);
        decoGroup.add(log);
      }
    }
    if (!t.kind && t.terrain !== "water" && DEVICE.quality !== "low" && !DEVICE.phone && hash(t.x * 4.4, t.z * 1.6) > 0.82) {
      const p = cellToWorld(t.x, t.z);
      const weed = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0x3a5228 })
      );
      weed.scale.set(1.2, 0.45, 1);
      weed.position.set(p.x + (hash(1, t.x) - 0.5) * 2, terrainHeight(p.x, p.z) + 0.12, p.z + (hash(t.z, 4) - 0.5) * 2);
      decoGroup.add(weed);
    }
  }
}

function tuneGpu(city) {
  if (!renderer || DEVICE.pref !== "auto") return;
  let lots = 0;
  for (const t of city.tiles) {
    if (t.kind && t.kind !== "road" && t.kind !== "cobble" && t.kind !== "pier") lots += 1;
  }
  let next = DEVICE.quality;
  if ((DEVICE.phone || innerWidth <= 820) && lots > 28) next = "low";
  else if ((DEVICE.phone || DEVICE.quality === "mid") && lots > 42) next = "low";
  else if (lots > 86 && DEVICE.quality === "high") next = "mid";
  const drop = next !== DEVICE.quality && GFX_TIERS[next];
  if (drop) Object.assign(DEVICE, GFX_TIERS[next], { quality: next, pref: "auto" });
  let dpr = DEVICE.pixelRatio;
  if ((DEVICE.phone || DEVICE.quality === "low") && lots > 36) dpr = Math.min(dpr, 0.85);
  if ((DEVICE.phone || DEVICE.quality === "low") && lots > 60) dpr = Math.min(dpr, 0.7);
  renderer.setPixelRatio(dpr);
  if (drop && sun) {
    sun.shadow.mapSize.set(DEVICE.shadow, DEVICE.shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = true;
  }
}

export function rebuildCityMeshes(city) {
  disposeLoose(buildingGroup);
  buildingGroup.clear();
  tuneGpu(city);
  for (const t of city.tiles) {
    if (!t.kind) continue;
    if (isInfra(t.kind) && isBuilt(t)) continue;
    if (!isBuilt(t)) {
      const site = makeConstruction(t, loadTex);
      const p = cellToWorld(t.x, t.z);
      site.position.set(p.x, terrainHeight(p.x, p.z), p.z);
      if (t.facing) site.rotation.y = (t.facing * Math.PI) / 2;
      site.userData = { x: t.x, z: t.z, type: t.kind, construct: true };
      buildingGroup.add(site);
      continue;
    }
    if (isInfra(t.kind)) continue;
    const mesh = buildingMesh(t.kind, t.hScale || 1, t);
    const p = cellToWorld(t.x, t.z);
    const sb = streetSetback(city, t);
    const jx = t.kind === "house" || t.kind === "park" ? 0 : (hash(t.x, t.z + 9) - 0.5) * 0.28;
    const jz = t.kind === "house" || t.kind === "park" ? 0 : (hash(t.z, t.x + 4) - 0.5) * 0.28;
    mesh.position.set(p.x + sb.ox + jx, terrainHeight(p.x, p.z), p.z + sb.oz + jz);
    if (t.facing) mesh.rotation.y = (t.facing * Math.PI) / 2;
    mesh.userData = { x: t.x, z: t.z, type: t.kind, lit: !!t.powered };
    if (t.abandoned) {
      mesh.traverse((o) => {
        if (!o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const next = mats.map((m) => {
          const c = m.clone();
          if (c.color) c.color.multiplyScalar(0.36);
          return c;
        });
        o.material = Array.isArray(o.material) ? next : next[0];
      });
    }
    buildingGroup.add(mesh);
  }
  for (const t of city.tiles) {
    if (!t.cable || !isPaved(t.kind) || !isBuilt(t)) continue;
    const p = cellToWorld(t.x, t.z);
    const y = terrainHeight(p.x, p.z) + 0.07;
    const n = tileAt(city, t.x, t.z + 1);
    const s = tileAt(city, t.x, t.z - 1);
    const e = tileAt(city, t.x + 1, t.z);
    const w = tileAt(city, t.x - 1, t.z);
    const alongZ = isPaved(n?.kind) || isPaved(s?.kind);
    const alongX = isPaved(e?.kind) || isPaved(w?.kind);
    const live = !!(city.utilities?.liveCable && city.utilities.liveCable.has && city.utilities.liveCable.has(idx(t.x, t.z)));
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a2418 });
    const gold = new THREE.MeshLambertMaterial({ color: live ? 0xc4a46a : 0x3a342c });
    const strip = (len, axis) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(axis === "x" ? len : 0.16, 0.05, axis === "z" ? len : 0.16), mat);
      body.position.set(p.x, y, p.z);
      buildingGroup.add(body);
      const bead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.18), gold);
      bead.position.set(p.x, y + 0.02, p.z);
      buildingGroup.add(bead);
    };
    if (alongX) strip(CELL * 0.92, "x");
    if (alongZ || !alongX) strip(CELL * 0.92, "z");
  }
  scatterTrees(city);
  refreshOverlay(city, true);
  litCity = city;
  collectLights();
}

export function setOrbitLock(lock) {
  if (!controls) return;
  controls.enableRotate = !lock;
  controls.enablePan = !lock;
}

export function watchCamera(fn) {
  if (!controls) return () => {};
  controls.addEventListener("change", fn);
  return () => controls.removeEventListener("change", fn);
}

const _screen = new THREE.Vector3();
export function cellToScreen(x, z) {
  if (!camera || !renderer) return null;
  const p = cellToWorld(x, z);
  _screen.set(p.x, 1.4, p.z).project(camera);
  const vis = _screen.z < 1 && Math.abs(_screen.x) < 1.35 && Math.abs(_screen.y) < 1.35;
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: (_screen.x * 0.5 + 0.5) * rect.width + rect.left,
    y: (-_screen.y * 0.5 + 0.5) * rect.height + rect.top,
    visible: vis,
  };
}

export function setGhostDamping(placeMode) {
  if (!controls) return;
  controls.enableDamping = !placeMode;
  if (placeMode) {
    controls.enableDamping = false;
  }
}

export function setOverlayMode(mode) {
  overlayMode = mode || null;
  overlayStamp = "";
}

const overlayGeo = new THREE.PlaneGeometry(CELL * 0.9, CELL * 0.9);
overlayGeo.userData.shared = true;
let overlayStamp = "";
let overlayAt = 0;

export function refreshOverlay(city, force = false) {
  const mode = overlayMode || "";
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (!mode) {
    if (overlayGroup.children.length) {
      disposeLoose(overlayGroup);
      overlayGroup.clear();
    }
    overlayStamp = "";
    return;
  }
  if (!force && overlayStamp.startsWith(mode + ":") && now - overlayAt < 1000) return;
  overlayStamp = `${mode}:${city.tickCount || 0}`;
  overlayAt = now;
  disposeLoose(overlayGroup);
  overlayGroup.clear();
  const geo = overlayGeo;
  const mats = new Map();
  const thin = DEVICE.phone || DEVICE.quality === "low";
  for (const t of city.tiles) {
    if (thin && !t.kind) continue;
    const sample = overlaySample(city, t.x, t.z, overlayMode);
    if (!sample) continue;
    const key = `${sample.color}:${sample.opacity.toFixed(2)}`;
    let mat = mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: sample.color,
        transparent: true,
        opacity: sample.opacity,
        depthWrite: false,
        depthTest: sample.ontop !== true,
      });
      mats.set(key, mat);
    }
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    const p = cellToWorld(t.x, t.z, _worldA);
    m.position.set(p.x, terrainHeight(p.x, p.z) + (sample.ontop ? 0.28 : 0.11), p.z);
    overlayGroup.add(m);
  }
}

export function setGhost(type, x, z, valid, facing = 0, idle = false) {
  if (ghost.mesh) {
    scene.remove(ghost.mesh);
    ghost.mesh = null;
  }
  if (!type || x == null || !inBounds(x, z)) return;
  const slabH = isInfra(type) || type === "park" || type === "bulldoze" || type === "cable" ? 0.16 : 0.22;
  const group = new THREE.Group();
  const p = cellToWorld(x, z);
  const gy = terrainHeight(p.x, p.z);
  group.position.set(p.x, 0, p.z);
  group.rotation.y = (facing || 0) * Math.PI * 0.5;
  const shadowMat = (opacity) =>
    new THREE.MeshBasicMaterial({
      color: 0x05060a,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  const blob = (sx, sz, opacity, yOff, ox, oz) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(CELL * 0.58, 36), shadowMat(opacity));
    m.rotation.x = -Math.PI / 2;
    m.position.set(ox, gy + yOff, oz);
    m.scale.set(sx, sz, 1);
    m.renderOrder = 3;
    group.add(m);
  };
  const warn = !!(valid && idle);
  const dark = valid ? 0.55 : 0.4;
  blob(1.72, 1.38, dark * 0.45, 0.025, 0.22, 0.28);
  blob(1.28, 1.05, dark, 0.04, 0.12, 0.16);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(CELL * 0.86, slabH, CELL * 0.86),
    new THREE.MeshBasicMaterial({
      color: warn ? 0xffd27a : valid ? 0x7dffa1 : 0xff6b6b,
      transparent: true,
      opacity: valid ? 0.62 : 0.52,
      depthWrite: false,
    })
  );
  slab.position.y = gy + slabH * 0.5 + 0.14;
  slab.renderOrder = 4;
  group.add(slab);
  const radLots = DEFS[type]?.radius;
  if (radLots && (type === "power" || type === "cistern" || type === "sewer" || type === "fire" || type === "school" || type === "clinic" || type === "hospital" || type === "park" || type === "civic" || type === "market" || type === "shop" || type === "warehouse" || type === "factory")) {
    const r = radLots * CELL;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(CELL * 0.8, r - CELL * 0.4), r + CELL * 0.12, 64),
      new THREE.MeshBasicMaterial({
        color: warn ? 0xffd27a : valid ? 0x7dffa1 : 0xffd27a,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = gy + 0.22;
    group.add(ring);
  }
  scene.add(group);
  ghost.mesh = group;
}

export function setRangeHalo(x, z, radiusLots, color = 0x7dffa1) {
  const key = x == null || !radiusLots ? "" : `${x}:${z}:${radiusLots}:${color}`;
  if (key === rangeHalo.key && (key === "" || rangeHalo.mesh)) return;
  if (rangeHalo.mesh) {
    scene.remove(rangeHalo.mesh);
    rangeHalo.mesh.geometry?.dispose();
    rangeHalo.mesh.material?.dispose();
    rangeHalo.mesh = null;
  }
  rangeHalo.key = key;
  if (!key || !inBounds(x, z)) return;
  const p = cellToWorld(x, z);
  const gy = terrainHeight(p.x, p.z);
  const r = radiusLots * CELL;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(CELL * 0.8, r - CELL * 0.4), r + CELL * 0.12, 64),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(p.x, gy + 0.22, p.z);
  ring.renderOrder = 5;
  scene.add(ring);
  rangeHalo.mesh = ring;
}

export function setDayNight(hour24) {
  const h = ((hour24 % 24) + 24) % 24;
  const dawn = smooth(h, 5.0, 7.0);
  const dusk = 1 - smooth(h, 15.6, 19.4);
  const day = dawn * dusk;
  const night = 1 - day;
  const golden = (h >= 15.4 && h < 19.2) || (h >= 5.4 && h < 7.6);

  const az = ((h - 5.4) / 13.2) * Math.PI;
  const elev = Math.max(Math.sin(((h - 5.4) / 13.2) * Math.PI), -0.12);
  sun.position.set(Math.cos(az) * 240, Math.max(elev, 0.03) * 95 + 6, Math.sin(az) * 90);
  const sunCol = _sunCol.setHSL(
    night > 0.7 ? 0.62 : golden ? 0.07 : THREE.MathUtils.lerp(0.08, 0.12, day),
    night > 0.7 ? 0.15 : golden ? 0.72 : THREE.MathUtils.lerp(0.45, 0.22, day),
    THREE.MathUtils.lerp(0.5, golden ? 0.68 : 0.9, day)
  );
  sun.color.copy(sunCol);
  sun.intensity = THREE.MathUtils.lerp(0.08, golden ? 3.4 : 2.7, Math.max(day, 0.04));
  if (sunGlow) {
    sunGlow.position.copy(sun.position).setLength(420);
    sunGlow.material.color.copy(sunCol);
    sunGlow.material.opacity = THREE.MathUtils.lerp(0.05, golden ? 0.9 : 0.45, day);
    sunGlow.scale.setScalar(golden ? 48 : 28);
  }
  hemi.color.set(night > 0.55 ? 0x4a6288 : golden ? 0xffc89a : 0xd0dce8);
  hemi.groundColor.set(night > 0.55 ? 0x141820 : 0x3a2e22);
  hemi.intensity = THREE.MathUtils.lerp(0.38, golden ? 0.62 : 0.78, day) + night * 0.2;
  fill.color.set(night > 0.55 ? 0x6a88c0 : golden ? 0xffb070 : 0xc4d4e8);
  fill.intensity = THREE.MathUtils.lerp(0.16, golden ? 0.55 : 0.32, day);
  fill.position.copy(sun.position).multiplyScalar(-0.35);
  fill.position.y = 40;
  _fogB.set(golden ? 0xc8b4a0 : 0xb4c2d0);
  const fog = _fog.lerpColors(_fogA, _fogB, day);
  scene.fog.color.copy(fog);
  scene.background = fog;
  if (skyMesh?.material) {
    skyMesh.material.color.setScalar(THREE.MathUtils.lerp(0.28, 1, day));
  }
  if (hazeMesh?.material) {
    hazeMesh.material.opacity = THREE.MathUtils.lerp(0.12, 0.38, day);
  }
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.94, golden ? 1.28 : 1.12, day);
  if (bloom) bloom.strength = night * 0.55;

  if (waterMesh?.material?.uniforms?.uSunDir) {
    waterMesh.material.uniforms.uSunDir.value.copy(sun.position).normalize();
    waterMesh.material.uniforms.uSunColor.value.copy(sunCol);
    waterMesh.material.uniforms.uSky.value.copy(fog);
    waterMesh.material.uniforms.uNight.value = night;
  }

  glowNight = night;
  glowGolden = golden;
  if (litCity) syncWindowLights(litCity);
  else applyGlassEmit();
  const lampEmit = 0.35 + night * 2.25;
  const glowOp = 0.14 + night * 0.42;
  for (const o of lamps) {
    if (o.userData.lamp && o.material) o.material.emissiveIntensity = lampEmit;
    if (o.userData.lampGlow && o.material) {
      const base = o.material.userData.glowBase || 1;
      o.material.opacity = Math.min(0.85, glowOp * base);
    }
  }
}

let glowNight = 0;
let glowGolden = false;
let litCity = null;

function applyGlassEmit() {
  const emit = glowNight * 2.45 + (glowGolden ? 0.5 : 0);
  for (const m of nightGlass) {
    if (!m) continue;
    const owned = !!m.userData.nightOwned;
    const lit = !owned || m.userData.lit !== false;
    m.emissiveIntensity = emit * (m.userData.nightScale || 1) * (lit ? 1 : 0.04);
  }
}

export function syncWindowLights(city) {
  if (city) litCity = city;
  const src = city || litCity;
  if (!src || !buildingGroup) return false;
  for (const mesh of buildingGroup.children) {
    if (mesh.userData?.x == null) continue;
    const t = tileAt(src, mesh.userData.x, mesh.userData.z);
    const lit = !!(t && t.powered);
    mesh.userData.lit = lit;
    mesh.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m?.userData?.nightOwned) m.userData.lit = lit;
      }
    });
  }
  applyGlassEmit();
  return true;
}

function collectLights() {
  nightGlass.length = 0;
  lamps.length = 0;
  buildingGroup.traverse((o) => {
    let host = o;
    while (host && host.userData.x == null) host = host.parent;
    const lit = !host || host.userData.lit !== false;
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m && (m.emissiveMap || m.userData.nightGlass)) {
        if (m.userData.nightOwned) m.userData.lit = lit;
        nightGlass.push(m);
      }
    }
    if (o.userData.lamp || o.userData.lampGlow) lamps.push(o);
  });
  scene.traverse((o) => {
    if (o.userData.lamp || o.userData.lampGlow) lamps.push(o);
  });
}

function makeSignal() {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.35 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.15, 5), iron);
  pole.position.y = 1.55;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.18), iron);
  head.position.set(0, 3.05, 0.12);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1a8a3a, emissive: 0x1a8a3a, emissiveIntensity: 0.85 })
  );
  lamp.position.set(0, 3.12, 0.22);
  lamp.userData.signalLamp = true;
  g.add(pole, head, lamp);
  g.userData.signal = true;
  return g;
}

function makeStopSign() {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.45, metalness: 0.3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.15, 5), iron);
  pole.position.y = 1.08;
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.04, 8),
    new THREE.MeshStandardMaterial({ color: 0xa82828, roughness: 0.55 })
  );
  face.rotation.x = Math.PI * 0.5;
  face.position.y = 2.12;
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.5 })
  );
  blade.position.y = 2.12;
  g.add(pole, face, blade);
  return g;
}

function isXing(city, x, z) {
  const n = neighborsRoad(city, x, z);
  return (n.n || n.s) && (n.e || n.w);
}

function yawAlong(dx, dz) {
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(-dz, dx);
}

function roadSteps(city, x, z) {
  const out = [];
  const tryAdd = (dx, dz) => {
    const n = tileAt(city, x + dx, z + dz);
    if (n && isPaved(n.kind) && isBuilt(n)) out.push([dx, dz]);
  };
  tryAdd(1, 0);
  tryAdd(-1, 0);
  tryAdd(0, 1);
  tryAdd(0, -1);
  return out;
}

function pickNextRoad(city, x, z, inDx, inDz, salt = 0) {
  const dirs = roadSteps(city, x, z);
  if (!dirs.length) return [x - inDx, z - inDz];
  const forward = dirs.find(([dx, dz]) => dx === inDx && dz === inDz);
  const turns = dirs.filter(([dx, dz]) => !(dx === -inDx && dz === -inDz));
  const keep = forward && hash(x + salt, z + inDx) > 0.28;
  const pool = keep ? [[inDx, inDz], ...turns] : turns.length ? turns : dirs;
  const [dx, dz] = pool[Math.floor(hash(x * 1.7 + salt, z * 2.3 + inDz) * pool.length) % pool.length];
  return [x + dx, z + dz];
}

function yawToRoad(city, x, z) {
  const n = neighborsRoad(city, x, z);
  if (n.e) return 0;
  if (n.w) return Math.PI;
  if (n.n) return -Math.PI * 0.5;
  if (n.s) return Math.PI * 0.5;
  return hash(x, z) * Math.PI;
}

function placeCarOnSeg(car, city, d) {
  const a = cellToWorld(d.cx, d.cz, _worldA);
  const b = cellToWorld(d.nx, d.nz, _worldB);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  const lane = d.lane || 1.22;
  const ox = fz * lane;
  const oz = -fx * lane;
  const x = a.x + dx * d.u + ox;
  const z = a.z + dz * d.u + oz;
  car.position.set(x, terrainHeight(x, z) + (d.walk ? 0 : 0.02), z);
  car.rotation.y = yawAlong(dx, dz);
  car.userData.drive = d;
}

let trafficCity = null;

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
  let best = { x, z };
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      if (!inBounds(cx, cz)) continue;
      const s = cellToScreen(cx, cz);
      if (!s) continue;
      const d = Math.hypot(event.clientX - s.x, event.clientY - s.y);
      if (d < bestD) {
        bestD = d;
        best = { x: cx, z: cz };
      }
    }
  }
  return best;
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

const focus = { active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, damp: null, camFrom: null, camTo: null };

export function isFocusing() {
  return !!(focus.active && focus.t < 1);
}

function cellInView(x, z) {
  const s = cellToScreen(x, z);
  if (!s || !s.visible) return false;
  const phone = DEVICE.touch || DEVICE.phone || innerWidth <= 820;
  if (phone) {
    const top = 200;
    const bottom = innerHeight * 0.56;
    const insetX = Math.max(72, innerWidth * 0.2);
    return s.y > top && s.y < bottom && s.x > insetX && s.x < innerWidth - insetX;
  }
  return s.x > 16 && s.x < innerWidth - 270 && s.y > 96 && s.y < innerHeight - 96;
}

export function updateBuildSites(city) {
  for (const g of buildingGroup.children) {
    if (!g.userData.construct) continue;
    const t = tileAt(city, g.userData.x, g.userData.z);
    if (t && t.kind) syncConstruction(g, t, loadTex);
  }
}

export function focusCell(x, z) {
  if (!controls) return false;
  const phone = DEVICE.touch || DEVICE.phone || innerWidth <= 820;
  if (phone && camera) {
    if (cellInView(x, z)) {
      focus.active = false;
      return false;
    }
    const p = cellToWorld(x, z);
    controls.target.set(p.x, 1.2, p.z);
    camera.position.set(p.x - 16, 22, p.z - 36);
    controls.enableDamping = false;
    controls.update();
    focus.active = false;
    return true;
  }
  if (cellInView(x, z)) {
    focus.active = false;
    return false;
  }
  const p = cellToWorld(x, z);
  focus.to.set(p.x, 1.2, p.z);
  focus.from.copy(controls.target);
  focus.t = 0;
  focus.active = true;
  focus.damp = controls.enableDamping;
  controls.enableDamping = false;
  focus.camFrom = null;
  focus.camTo = null;
  return true;
}

export function onGfxChange(fn) {
  gfxHook = fn;
}

export function applyQuality(pref) {
  setGfxPref(pref);
  const next = detectDevice();
  Object.assign(DEVICE, next);
  if (!renderer) return DEVICE;
  renderer.setPixelRatio(DEVICE.pixelRatio);
  renderer.shadowMap.type = THREE.PCFShadowMap;
  if (sun) {
    sun.shadow.mapSize.set(DEVICE.shadow, DEVICE.shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  renderer.shadowMap.needsUpdate = true;
  gfxHook?.(DEVICE.quality);
  return DEVICE;
}

export function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  lastFps = Math.round(1 / Math.max(dt, 0.001));
  if (DEVICE.pref === "auto" && DEVICE.quality !== "low") {
    if (dt > 0.038) poorFrames += 1;
    else poorFrames = Math.max(0, poorFrames - 2);
    if (poorFrames > 40) {
      poorFrames = 0;
      const next = DEVICE.quality === "high" ? "mid" : "low";
      Object.assign(DEVICE, GFX_TIERS[next], { quality: next, pref: "auto" });
      renderer.setPixelRatio(DEVICE.pixelRatio);
      if (sun) {
        sun.shadow.mapSize.set(DEVICE.shadow, DEVICE.shadow);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
      renderer.shadowMap.needsUpdate = true;
      gfxHook?.(next);
    }
  }
  controls.update();
  if (focus.active) {
    focus.t = Math.min(1, focus.t + dt * 2.4);
    const e = focus.t * focus.t * (3 - 2 * focus.t);
    controls.target.lerpVectors(focus.from, focus.to, e);
    if (focus.camFrom && focus.camTo) camera.position.lerpVectors(focus.camFrom, focus.camTo, e);
    if (focus.t >= 1) {
      focus.active = false;
      if (focus.damp != null) controls.enableDamping = focus.damp;
      focus.damp = null;
      focus.camFrom = null;
      focus.camTo = null;
    }
  }
  if (waterMesh?.material?.uniforms?.uTime) {
    waterMesh.material.uniforms.uTime.value += dt;
    waterMesh.material.uniforms.uCameraPos.value.copy(camera.position);
  }
  const wind = clock.elapsedTime;
  const city = trafficCity;
  const hour = city ? ((city.time % 24) + 24) % 24 : 16;
  const night = hour < 5.5 || hour >= 22;
  const commute = (hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 18.5);
  for (const car of drivers) {
    const d = car.userData.drive;
    if (!d || !city) continue;
    const here = tileAt(city, d.cx, d.cz);
    const jam = here?.traffic || 0;
    const spd = d.base * (night ? 0.42 : commute ? 1.08 : 1) * Math.max(0.28, 1 - jam * 0.08);
    const goingZ = d.nz !== d.cz;
    const phase = Math.floor(clock.elapsedTime / 3.6) % 2;
    const green = goingZ ? phase === 0 : phase === 1;
    const hold = !d.walk && !green && d.u > 0.68 && isXing(city, d.nx, d.nz);
    if (!hold) d.u += (spd * dt) / CELL;
    let hops = 0;
    while (d.u >= 1 && hops < 3) {
      d.u -= 1;
      hops += 1;
      const inDx = d.nx - d.cx;
      const inDz = d.nz - d.cz;
      d.cx = d.nx;
      d.cz = d.nz;
      d.salt = (d.salt || 0) + 1;
      const next = pickNextRoad(city, d.cx, d.cz, inDx, inDz, d.salt);
      const nTile = tileAt(city, next[0], next[1]);
      if (nTile && isPaved(nTile.kind) && isBuilt(nTile)) {
        d.nx = next[0];
        d.nz = next[1];
      } else {
        d.nx = d.cx - inDx;
        d.nz = d.cz - inDz;
      }
    }
    const a = cellToWorld(d.cx, d.cz, _worldA);
    const b = cellToWorld(d.nx, d.nz, _worldB);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const lane = d.lane || 1.22;
    const ox = fz * lane;
    const oz = -fx * lane;
    const x = a.x + dx * d.u + ox;
    const z = a.z + dz * d.u + oz;
    car.position.set(x, terrainHeight(x, z) + (d.walk ? 0 : 0.02), z);
    const want = yawAlong(dx, dz);
    let err = want - car.rotation.y;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    if (Math.abs(err) > 2) car.rotation.y = want;
    else car.rotation.y += err * Math.min(1, dt * 14);
    const dist = spd * dt;
    if (!d.walk) for (const hub of car.userData.wheels || []) hub.rotation.z -= dist / 0.16;
  }
  const phase = Math.floor(clock.elapsedTime / 3.6) % 2;
  const hex = phase === 0 ? 0x1a8a3a : 0xa8241c;
  for (const sig of signals) {
    sig.traverse((c) => {
      if (!c.userData.signalLamp || !c.material) return;
      c.material.color.setHex(hex);
      c.material.emissive.setHex(hex);
    });
  }
  for (const boat of boatGroup.children) {
    const s = boat.userData.sail;
    if (!s) continue;
    s.x += (s.dir * s.spd * dt) / CELL;
    if (s.x > 44) {
      s.x = 44;
      s.dir = -1;
    } else if (s.x < 5) {
      s.x = 5;
      s.dir = 1;
    }
    const wx = (s.x - (SIZE - 1) / 2) * CELL;
    const wz = shorelineWorldZ(wx) - s.off;
    boat.position.set(wx, 0.03 + Math.sin(wind * 1.4 + s.x) * 0.05, wz);
    boat.rotation.y = yawAlong(s.dir, 0);
  }
  if (DEVICE.sway) {
    for (let i = 0; i < treeGroup.children.length; i++) {
      const sway = treeGroup.children[i].userData.sway;
      if (!sway) continue;
      const ph = treeGroup.children[i].userData.phase || i;
      sway.rotation.z = Math.sin(wind * 0.55 + ph) * 0.03;
      sway.rotation.x = Math.cos(wind * 0.38 + ph * 1.25) * 0.014;
    }
  }
  shadowTick += 1;
  if (shadowTick % 2 === 0) renderer.shadowMap.needsUpdate = true;
  if (window.__harborLost) return dt;
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
