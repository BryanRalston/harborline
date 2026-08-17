import * as THREE from "three";
import { ASSET_PATHS } from "./buildings.js";
import { CELL, cellToWorld, inBounds, terrainHeight, tileAt } from "./city.js";
import { isBuilt } from "./construction.js";

function isKind(city, x, z, kind) {
  const t = tileAt(city, x, z);
  return t?.kind === kind && isBuilt(t);
}

function collectRuns(city, kind, axis) {
  const runs = [];
  for (const t of city.tiles) {
    if (t.kind !== kind) continue;
    if (axis === "x") {
      if (isKind(city, t.x - 1, t.z, kind)) continue;
      let b = t.x;
      while (isKind(city, b + 1, t.z, kind)) b += 1;
      runs.push({ axis, a: t.x, b, k: t.z });
    } else {
      if (isKind(city, t.x, t.z - 1, kind)) continue;
      let b = t.z;
      while (isKind(city, t.x, b + 1, kind)) b += 1;
      runs.push({ axis, a: t.z, b, k: t.x });
    }
  }
  return runs;
}

function segsWhere(a, b, pred) {
  const out = [];
  let s = null;
  for (let i = a; i <= b; i++) {
    if (pred(i)) {
      if (s == null) s = i;
    } else if (s != null) {
      out.push([s, i - 1]);
      s = null;
    }
  }
  if (s != null) out.push([s, b]);
  return out;
}

function runWorld(run) {
  if (run.axis === "x") {
    const p0 = cellToWorld(run.a, run.k);
    const p1 = cellToWorld(run.b, run.k);
    return {
      cx: (p0.x + p1.x) * 0.5,
      cz: p0.z,
      len: (run.b - run.a + 1) * CELL,
      y: (terrainHeight(p0.x, p0.z) + terrainHeight(p1.x, p1.z)) * 0.5,
    };
  }
  const p0 = cellToWorld(run.k, run.a);
  const p1 = cellToWorld(run.k, run.b);
  return {
    cx: p0.x,
    cz: (p0.z + p1.z) * 0.5,
    len: (run.b - run.a + 1) * CELL,
    y: (terrainHeight(p0.x, p0.z) + terrainHeight(p1.x, p1.z)) * 0.5,
  };
}

function makeDash() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = "#2c2d30";
  g.fillRect(0, 0, 256, 16);
  g.fillStyle = "#d9d0b4";
  for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 7, 6, 14, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LANE = 5.15;
const WALK = 1.22;

function coveredByPerp(run, perpRuns) {
  if (run.b > run.a) return false;
  const x = run.axis === "x" ? run.a : run.k;
  const z = run.axis === "x" ? run.k : run.a;
  return perpRuns.some(
    (r) =>
      r.b > r.a &&
      (run.axis === "x" ? r.k === x && r.a <= z && z <= r.b : r.k === z && r.a <= x && x <= r.b)
  );
}

function isPromenade(city, run) {
  let n = 0;
  let shore = 0;
  if (run.axis === "x") {
    for (let x = run.a; x <= run.b; x++) {
      n += 1;
      if (tileAt(city, x, run.k)?.shoreline) shore += 1;
    }
  } else {
    for (let z = run.a; z <= run.b; z++) {
      n += 1;
      if (tileAt(city, run.k, z)?.shoreline) shore += 1;
    }
  }
  return shore / Math.max(1, n) > 0.42;
}

export function createStreets(city, loadTex) {
  const root = new THREE.Group();
  root.name = "streets";
  const asphMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["asphalt.jpg"], [8, 1]),
    roughness: 0.82,
    metalness: 0.04,
  });
  const cobbleMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["cobble.jpg"], [6, 1]),
    roughness: 0.86,
    metalness: 0.03,
    color: 0xc8c2b6,
  });
  const walkMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["concrete.jpg"], [5, 1]),
    roughness: 0.88,
    metalness: 0.02,
    color: 0xe4e0d8,
  });
  const dash = makeDash();
  const hRuns = collectRuns(city, "road", "x");
  const vRuns = collectRuns(city, "road", "z");

  function asphalt(run) {
    const w = runWorld(run);
    const promenade = isPromenade(city, run);
    const mesh = new THREE.Mesh(
      run.axis === "x"
        ? new THREE.BoxGeometry(w.len + 0.1, 0.07, promenade ? LANE * 1.08 : LANE)
        : new THREE.BoxGeometry(promenade ? LANE * 1.08 : LANE, 0.07, w.len + 0.1),
      promenade ? cobbleMat : asphMat
    );
    mesh.position.set(w.cx, w.y + 0.055, w.cz);
    mesh.receiveShadow = true;
    root.add(mesh);
    if (promenade || run.b - run.a < 2) return;
    const map = dash.clone();
    map.repeat.set(Math.max(2, run.b - run.a), 1);
    const line = new THREE.Mesh(
      run.axis === "x"
        ? new THREE.PlaneGeometry(w.len * 0.9, 0.15)
        : new THREE.PlaneGeometry(0.15, w.len * 0.9),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(w.cx, w.y + 0.094, w.cz);
    root.add(line);
  }

  function walk(x0, z0, x1, z1, alongX, sideX, sideZ) {
    const p0 = cellToWorld(x0, z0);
    const p1 = cellToWorld(x1, z1);
    const len = alongX ? (x1 - x0 + 1) * CELL : (z1 - z0 + 1) * CELL;
    const mesh = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(len, 0.055, WALK) : new THREE.BoxGeometry(WALK, 0.055, len),
      walkMat
    );
    const y = (terrainHeight(p0.x, p0.z) + terrainHeight(p1.x, p1.z)) * 0.5 + 0.08;
    mesh.position.set((p0.x + p1.x) * 0.5 + sideX, y, (p0.z + p1.z) * 0.5 + sideZ);
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  for (const run of hRuns) {
    if (!coveredByPerp(run, vRuns)) asphalt(run);
  }
  for (const run of vRuns) {
    if (run.b === run.a) continue;
    asphalt(run);
  }

  const curb = (LANE + WALK) * 0.5;
  for (const run of hRuns) {
    if (coveredByPerp(run, vRuns)) continue;
    for (const [a, b] of segsWhere(run.a, run.b, (x) => !isKind(city, x, run.k + 1, "road"))) {
      walk(a, run.k, b, run.k, true, 0, curb);
    }
    for (const [a, b] of segsWhere(run.a, run.b, (x) => !isKind(city, x, run.k - 1, "road"))) {
      walk(a, run.k, b, run.k, true, 0, -curb);
    }
  }
  for (const run of vRuns) {
    if (run.b === run.a) continue;
    for (const [a, b] of segsWhere(run.a, run.b, (z) => !isKind(city, run.k + 1, z, "road"))) {
      walk(run.k, a, run.k, b, false, curb, 0);
    }
    for (const [a, b] of segsWhere(run.a, run.b, (z) => !isKind(city, run.k - 1, z, "road"))) {
      walk(run.k, a, run.k, b, false, -curb, 0);
    }
  }

  addLamps(root, hRuns, vRuns);
  addPromenadeRail(root, city, hRuns);
  return root;
}

function addPromenadeRail(root, city, hRuns) {
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.45, metalness: 0.4 });
  for (const run of hRuns) {
    if (!isPromenade(city, run) || run.b - run.a < 2) continue;
    const w = runWorld(run);
    const count = Math.max(3, Math.floor(w.len / 2.6));
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const px = w.cx - w.len * 0.46 + u * w.len * 0.92;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.08, 5), iron);
      post.position.set(px, w.y + 0.64, w.cz - 3.35);
      post.castShadow = true;
      root.add(post);
      if (i % 4 === 2) {
        const wood = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.82 });
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.44), wood);
        seat.position.set(px, w.y + 0.4, w.cz - 2.15);
        root.add(seat);
      }
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w.len * 0.9, 0.045, 0.045), iron);
    bar.position.set(w.cx, w.y + 1.08, w.cz - 3.35);
    root.add(bar);
  }
}

function addLamps(root, hRuns, vRuns) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.55, metalness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xffc070,
    emissiveIntensity: 0.2,
  });
  const place = (x, z, ox, oz) => {
    if (!inBounds(x, z)) return;
    const p = cellToWorld(x, z);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), poleMat);
    pole.position.y = 2.3;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bulbMat);
    bulb.position.y = 4.4;
    bulb.userData.lamp = true;
    g.add(pole, bulb);
    g.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz), p.z + oz);
    root.add(g);
  };
  for (const run of hRuns) {
    for (let x = run.a; x <= run.b; x += 3) {
      if ((x + run.k) % 2 === 0) place(x, run.k, 0.15, 3.4);
    }
  }
  for (const run of vRuns) {
    for (let z = run.a; z <= run.b; z += 3) {
      if ((z + run.k) % 2 === 0) place(run.k, z, 3.4, 0.15);
    }
  }
}

export function createPiers(city, loadTex) {
  const root = new THREE.Group();
  root.name = "piers";
  const wood = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["wood_dock.jpg"], [5, 1]),
    roughness: 0.78,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const xRuns = collectRuns(city, "pier", "x");
  const zRuns = collectRuns(city, "pier", "z");
  const runs = [
    ...xRuns.filter((r) => !coveredByPerp(r, zRuns)),
    ...zRuns.filter((r) => r.b > r.a),
  ];
  for (const run of runs) {
    const w = runWorld(run);
    const deck = new THREE.Mesh(
      run.axis === "x"
        ? new THREE.BoxGeometry(w.len - 0.35, 0.16, 6.6)
        : new THREE.BoxGeometry(6.6, 0.16, w.len - 0.35),
      wood
    );
    deck.position.set(w.cx, 0.1, w.cz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);
    const count = Math.max(2, run.b - run.a + 1);
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const px = run.axis === "x" ? w.cx - w.len * 0.45 + u * w.len * 0.9 : w.cx;
      const pz = run.axis === "z" ? w.cz - w.len * 0.45 + u * w.len * 0.9 : w.cz;
      for (const side of [-2.45, 2.45]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 2.1, 6), postMat);
        post.position.set(
          run.axis === "x" ? px : px + side,
          -0.85,
          run.axis === "x" ? pz + side : pz
        );
        post.castShadow = true;
        root.add(post);
      }
    }
  }
  return root;
}

export function streetSetback(city, t) {
  let ox = 0;
  let oz = 0;
  if (isKind(city, t.x, t.z + 1, "road")) oz -= 0.38;
  if (isKind(city, t.x, t.z - 1, "road")) oz += 0.38;
  if (isKind(city, t.x + 1, t.z, "road")) ox -= 0.38;
  if (isKind(city, t.x - 1, t.z, "road")) ox += 0.38;
  return { ox, oz };
}
