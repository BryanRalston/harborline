import * as THREE from "three";
import { ASSET_PATHS } from "./buildings.js";
import { CELL, cellToWorld, hash, inBounds, terrainHeight, tileAt } from "./city.js";
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
    roughness: 0.62,
    metalness: 0.08,
    color: 0xb8b0a4,
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
  addStreetBits(root, city);
  return root;
}

function addStreetBits(root, city) {
  const stripe = new THREE.MeshBasicMaterial({ color: 0xe8e0d0, depthWrite: false });
  const iron = new THREE.MeshStandardMaterial({ color: 0x8a1c16, roughness: 0.45, metalness: 0.25 });
  const lid = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.5, metalness: 0.3 });
  for (const t of city.tiles) {
    if (t.kind !== "road" || !isBuilt(t)) continue;
    const n = {
      n: isKind(city, t.x, t.z + 1, "road"),
      s: isKind(city, t.x, t.z - 1, "road"),
      e: isKind(city, t.x + 1, t.z, "road"),
      w: isKind(city, t.x - 1, t.z, "road"),
    };
    const p = cellToWorld(t.x, t.z);
    const y = terrainHeight(p.x, p.z);
    if ((n.n || n.s) && (n.e || n.w) && hash(t.x, t.z) > 0.35) {
      const alongZ = n.n || n.s;
      for (let i = -2; i <= 2; i++) {
        const bar = new THREE.Mesh(
          alongZ ? new THREE.PlaneGeometry(2.2, 0.16) : new THREE.PlaneGeometry(0.16, 2.2),
          stripe
        );
        bar.rotation.x = -Math.PI / 2;
        bar.position.set(p.x + (alongZ ? 0 : i * 0.32), y + 0.1, p.z + (alongZ ? i * 0.32 : 0));
        root.add(bar);
      }
    }
    if (hash(t.x * 3.1, t.z * 2.7) > 0.82) {
      const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.55, 6), iron);
      hyd.position.set(p.x + 2.9, y + 0.32, p.z + 2.6);
      hyd.castShadow = true;
      root.add(hyd);
    }
    if (hash(t.x * 1.4, t.z * 4.2) > 0.88) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10), lid);
      hole.position.set(p.x + 0.4, y + 0.09, p.z - 0.3);
      root.add(hole);
    }
    if (hash(t.x * 2.6, t.z * 1.9) > 0.86) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 0.55, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3e36, roughness: 0.55, metalness: 0.18 })
      );
      can.position.set(p.x + 2.7, y + 0.34, p.z - 2.55);
      can.castShadow = true;
      root.add(can);
    }
    if (hash(t.x * 0.7, t.z * 5.1) > 0.9) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 5), lid);
      post.position.set(p.x - 2.75, y + 0.55, p.z + 2.4);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), iron);
      box.position.set(p.x - 2.75, y + 1.1, p.z + 2.4);
      root.add(post, box);
    }
    if (hash(t.x * 5.2, t.z * 1.1) > 0.84) {
      const meter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.1), lid);
      const mpost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 5), lid);
      mpost.position.set(p.x + 2.55, y + 0.45, p.z - 2.15);
      meter.position.set(p.x + 2.55, y + 0.95, p.z - 2.15);
      root.add(mpost, meter);
    }
    if (hash(t.x * 2.2, t.z * 6.4) > 0.87) {
      const rack = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.45 });
      for (const ox of [-0.28, 0.28]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 5, 10), rack);
        loop.position.set(p.x + 2.85 + ox, y + 0.42, p.z + 2.15);
        loop.rotation.y = Math.PI * 0.5;
        root.add(loop);
      }
    }
    if ((n.n || n.s) && (n.e || n.w)) {
      const stop = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xe8e0d0, depthWrite: false })
      );
      stop.rotation.x = -Math.PI / 2;
      stop.position.set(p.x, y + 0.1, p.z + (n.n ? 1.6 : -1.6));
      root.add(stop);
    }
  }
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
    const nBollard = Math.max(2, Math.floor(w.len / 3.2));
    for (let i = 0; i < nBollard; i++) {
      const u = nBollard === 1 ? 0.5 : i / (nBollard - 1);
      const bx = w.cx - w.len * 0.42 + u * w.len * 0.84;
      const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 6), iron);
      bol.position.set(bx, w.y + 0.32, w.cz - 2.55);
      root.add(bol);
    }
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
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), poleMat);
    arm.position.set(0.4, 4.25, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), bulbMat);
    bulb.position.set(0.78, 4.12, 0);
    bulb.userData.lamp = true;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.25, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffc070,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0.55, 0.05, 0);
    glow.userData.lampGlow = true;
    g.add(pole, arm, bulb, glow);
    g.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz), p.z + oz);
    root.add(g);
  };
  const pole = (x, z, ox, oz) => {
    if (!inBounds(x, z)) return;
    const p = cellToWorld(x, z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.88 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 6.4, 6), wood);
    post.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz) + 3.2, p.z + oz);
    post.castShadow = true;
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.07), wood);
    cross.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz) + 5.9, p.z + oz);
    root.add(post, cross);
  };
  for (const run of hRuns) {
    for (let x = run.a; x <= run.b; x += 3) {
      if ((x + run.k) % 2 === 0) place(x, run.k, 0.15, 3.4);
      if ((x + run.k) % 6 === 1) pole(x, run.k, -0.2, -3.35);
    }
  }
  for (const run of vRuns) {
    for (let z = run.a; z <= run.b; z += 3) {
      if ((z + run.k) % 2 === 0) place(run.k, z, 3.4, 0.15);
      if ((z + run.k) % 6 === 1) pole(run.k, z, -3.35, -0.2);
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
    deck.position.set(w.cx, 0.12, w.cz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);
    const edge = new THREE.Mesh(
      run.axis === "x"
        ? new THREE.BoxGeometry(w.len - 0.2, 0.08, 0.14)
        : new THREE.BoxGeometry(0.14, 0.08, w.len - 0.2),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.7 })
    );
    edge.position.set(w.cx, 0.22, w.cz + (run.axis === "x" ? 3.2 : 0));
    root.add(edge);
    const lamp = new THREE.MeshStandardMaterial({
      color: 0xffe2b0,
      emissive: 0xffc070,
      emissiveIntensity: 0.35,
    });
    const stringN = Math.max(3, Math.floor(w.len / 4));
    for (let i = 0; i < stringN; i++) {
      const u = stringN === 1 ? 0.5 : i / (stringN - 1);
      const lx = run.axis === "x" ? w.cx - w.len * 0.4 + u * w.len * 0.8 : w.cx;
      const lz = run.axis === "z" ? w.cz - w.len * 0.4 + u * w.len * 0.8 : w.cz;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), lamp);
      bulb.position.set(lx, 2.15, lz);
      bulb.userData.lamp = true;
      root.add(bulb);
      if (i > 0) {
        const prev = stringN === 1 ? 0.5 : (i - 1) / (stringN - 1);
        const px0 = run.axis === "x" ? w.cx - w.len * 0.4 + prev * w.len * 0.8 : w.cx;
        const pz0 = run.axis === "z" ? w.cz - w.len * 0.4 + prev * w.len * 0.8 : w.cz;
        const wire = new THREE.Mesh(
          new THREE.BoxGeometry(run.axis === "x" ? Math.abs(lx - px0) : 0.03, 0.02, run.axis === "z" ? Math.abs(lz - pz0) : 0.03),
          new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.6 })
        );
        wire.position.set((lx + px0) * 0.5, 2.18, (lz + pz0) * 0.5);
        root.add(wire);
      }
    }
    const cleatN = Math.max(2, Math.floor(w.len / 5.5));
    const cleatMat = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.35, metalness: 0.55 });
    for (let i = 0; i < cleatN; i++) {
      const u = cleatN === 1 ? 0.5 : i / (cleatN - 1);
      const cx = run.axis === "x" ? w.cx - w.len * 0.38 + u * w.len * 0.76 : w.cx + 2.4;
      const cz = run.axis === "z" ? w.cz - w.len * 0.38 + u * w.len * 0.76 : w.cz + 2.4;
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.12), cleatMat);
      cleat.position.set(cx, 0.24, cz);
      root.add(cleat);
      if (i % 2 === 0) {
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.42, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.8 })
        );
        crate.position.set(cx - 0.8, 0.38, cz - 0.4);
        crate.castShadow = true;
        root.add(crate);
      }
      const fender = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7 })
      );
      fender.position.set(cx, 0.05, run.axis === "x" ? cz + 3.15 : cz);
      root.add(fender);
    }
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
