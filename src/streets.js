import * as THREE from "three";
import { ASSET_PATHS } from "./buildings.js";
import { CELL, cellToWorld, hash, inBounds, isPaved, terrainHeight, tileAt } from "./city.js";
import { isBuilt } from "./construction.js";

function isKind(city, x, z, kind) {
  const t = tileAt(city, x, z);
  return t?.kind === kind && isBuilt(t);
}

function isPavedHere(city, x, z) {
  const t = tileAt(city, x, z);
  return !!(t && isPaved(t.kind) && isBuilt(t));
}

function collectRuns(city, pred, axis) {
  const match = typeof pred === "function" ? pred : (x, z) => isKind(city, x, z, pred);
  const runs = [];
  for (const t of city.tiles) {
    if (!match(t.x, t.z)) continue;
    if (axis === "x") {
      if (match(t.x - 1, t.z)) continue;
      let b = t.x;
      while (match(b + 1, t.z)) b += 1;
      runs.push({ axis, a: t.x, b, k: t.z });
    } else {
      if (match(t.x, t.z - 1)) continue;
      let b = t.z;
      while (match(t.x, b + 1)) b += 1;
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

function makeAsphaltTex() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.fillStyle = "#2a2b2e";
  g.fillRect(0, 0, s, s);
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < s * s; i++) {
    const x = i % s;
    const y = (i / s) | 0;
    const n =
      Math.sin(x * 0.37 + y * 0.19) * 6 +
      Math.sin(x * 1.7 + y * 2.1) * 4 +
      ((x * 13 + y * 29) % 9) -
      4;
    const wear = Math.exp(-((x - 80) ** 2) / 4200) * 10 + Math.exp(-((x - 176) ** 2) / 4200) * 10;
    const seam = y % 64 < 2 ? -10 : 0;
    const v = 38 + n + wear + seam;
    d[i * 4] = v;
    d[i * 4 + 1] = v + 1;
    d[i * 4 + 2] = v + 2;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = "rgba(18,18,20,0.35)";
  for (let i = 0; i < 18; i++) {
    g.fillRect((i * 73) % s, (i * 41) % s, 28 + (i % 5) * 8, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const ASPH = 5.2;
const CURB = 0.18;
const WALK = 1.08;
const LANE = ASPH;

function roadNeighbors(city, x, z) {
  return {
    n: isPavedHere(city, x, z + 1),
    s: isPavedHere(city, x, z - 1),
    e: isPavedHere(city, x + 1, z),
    w: isPavedHere(city, x - 1, z),
  };
}

function isXingN(n) {
  return (n.n || n.s) && (n.e || n.w);
}

function seawardDir(city, x, z) {
  for (const [dx, dz] of [
    [0, -1],
    [0, 1],
    [1, 0],
    [-1, 0],
  ]) {
    const n = tileAt(city, x + dx, z + dz);
    if (!n || n.terrain === "water" || n.kind === "pier" || n.shoreline) return { dx, dz };
  }
  return null;
}

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
      if (seawardDir(city, x, run.k)) shore += 1;
    }
  } else {
    for (let z = run.a; z <= run.b; z++) {
      n += 1;
      if (seawardDir(city, run.k, z)) shore += 1;
    }
  }
  return shore / Math.max(1, n) > 0.42;
}

export function createStreets(city, loadTex) {
  const root = new THREE.Group();
  root.name = "streets";
  const asphMat = new THREE.MeshStandardMaterial({
    map: makeAsphaltTex(),
    roughness: 0.92,
    metalness: 0.02,
    color: 0xb0b2b6,
  });
  const cobbleMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["cobble.jpg"], [2.4, 2.4]),
    roughness: 0.84,
    metalness: 0.04,
    color: 0x9a9186,
  });
  const walkMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["concrete.jpg"], [3, 1]),
    roughness: 0.9,
    metalness: 0.02,
    color: 0xddd8ce,
  });
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0x8e8a84,
    roughness: 0.78,
    metalness: 0.04,
  });
  const gutterMat = new THREE.MeshStandardMaterial({
    color: 0x1c1d20,
    roughness: 0.7,
    metalness: 0.08,
  });
  const paintMat = new THREE.MeshBasicMaterial({ color: 0xe6d27a, depthWrite: false });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xdcd6c8, depthWrite: false });
  const geoNS = new THREE.BoxGeometry(ASPH, 0.09, CELL + 0.12);
  const geoEW = new THREE.BoxGeometry(CELL + 0.12, 0.09, ASPH);
  const geoX = new THREE.BoxGeometry(CELL + 0.12, 0.1, CELL + 0.12);
  const curbNS = new THREE.BoxGeometry(CURB, 0.18, CELL + 0.04);
  const curbEW = new THREE.BoxGeometry(CELL + 0.04, 0.18, CURB);
  const walkNS = new THREE.BoxGeometry(WALK, 0.07, CELL + 0.04);
  const walkEW = new THREE.BoxGeometry(CELL + 0.04, 0.07, WALK);
  const gutterNS = new THREE.BoxGeometry(0.28, 0.04, CELL + 0.04);
  const gutterEW = new THREE.BoxGeometry(CELL + 0.04, 0.04, 0.28);
  const dashNS = new THREE.BoxGeometry(0.2, 0.012, 1.35);
  const dashEW = new THREE.BoxGeometry(1.35, 0.012, 0.2);
  const edgeNS = new THREE.BoxGeometry(0.09, 0.01, CELL * 0.92);
  const edgeEW = new THREE.BoxGeometry(CELL * 0.92, 0.01, 0.09);

  const hRuns = collectRuns(city, (x, z) => isPavedHere(city, x, z), "x");
  const vRuns = collectRuns(city, (x, z) => isPavedHere(city, x, z), "z");

  function addBox(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  }

  function paintCell(t) {
    if (!isPaved(t.kind) || !isBuilt(t)) return;
    const n = roadNeighbors(city, t.x, t.z);
    const ns = n.n || n.s;
    const ew = n.e || n.w;
    const xing = isXingN(n);
    const sea = seawardDir(city, t.x, t.z);
    const p = cellToWorld(t.x, t.z);
    const y = terrainHeight(p.x, p.z);
    const drive = t.kind === "cobble" ? cobbleMat : asphMat;
    addBox(xing ? geoX : ns && !ew ? geoNS : ew && !ns ? geoEW : geoX, drive, p.x, y + 0.05, p.z);

    if (!xing && t.kind !== "cobble") {
      if (ns && !ew) {
        addBox(dashNS, paintMat, p.x, y + 0.1, p.z);
        addBox(edgeNS, edgeMat, p.x - 2.38, y + 0.099, p.z);
        addBox(edgeNS, edgeMat, p.x + 2.38, y + 0.099, p.z);
      } else if (ew && !ns) {
        addBox(dashEW, paintMat, p.x, y + 0.1, p.z);
        addBox(edgeEW, edgeMat, p.x, y + 0.099, p.z - 2.38);
        addBox(edgeEW, edgeMat, p.x, y + 0.099, p.z + 2.38);
      }
    }

    const curbOff = ASPH * 0.5 + CURB * 0.42;
    const walkOff = ASPH * 0.5 + CURB + WALK * 0.5;
    const gutOff = ASPH * 0.5 - 0.1;
    const seaE = sea && sea.dx === 1;
    const seaW = sea && sea.dx === -1;
    const seaN = sea && sea.dz === 1;
    const seaS = sea && sea.dz === -1;

    function edge(side, water) {
      if (water) {
        if (side === "e") addBox(walkNS, cobbleMat, p.x + walkOff, y + 0.11, p.z);
        if (side === "w") addBox(walkNS, cobbleMat, p.x - walkOff, y + 0.11, p.z);
        if (side === "n") addBox(walkEW, cobbleMat, p.x, y + 0.11, p.z + walkOff);
        if (side === "s") addBox(walkEW, cobbleMat, p.x, y + 0.11, p.z - walkOff);
        return;
      }
      if (side === "e") {
        addBox(gutterNS, gutterMat, p.x + gutOff, y + 0.042, p.z);
        addBox(curbNS, curbMat, p.x + curbOff, y + 0.1, p.z);
        addBox(walkNS, walkMat, p.x + walkOff, y + 0.12, p.z);
      }
      if (side === "w") {
        addBox(gutterNS, gutterMat, p.x - gutOff, y + 0.042, p.z);
        addBox(curbNS, curbMat, p.x - curbOff, y + 0.1, p.z);
        addBox(walkNS, walkMat, p.x - walkOff, y + 0.12, p.z);
      }
      if (side === "n") {
        addBox(gutterEW, gutterMat, p.x, y + 0.042, p.z + gutOff);
        addBox(curbEW, curbMat, p.x, y + 0.1, p.z + curbOff);
        addBox(walkEW, walkMat, p.x, y + 0.12, p.z + walkOff);
      }
      if (side === "s") {
        addBox(gutterEW, gutterMat, p.x, y + 0.042, p.z - gutOff);
        addBox(curbEW, curbMat, p.x, y + 0.1, p.z - curbOff);
        addBox(walkEW, walkMat, p.x, y + 0.12, p.z - walkOff);
      }
    }

    if (!n.e) edge("e", seaE);
    if (!n.w) edge("w", seaW);
    if (!n.n) edge("n", seaN);
    if (!n.s) edge("s", seaS);
  }

  for (const t of city.tiles) paintCell(t);

  addLamps(root, city, hRuns, vRuns);
  addPromenadeRail(root, city, hRuns);
  addStreetBits(root, city);
  return root;
}

function addStreetBits(root, city) {
  const stripe = new THREE.MeshBasicMaterial({ color: 0xe8e0d0, depthWrite: false });
  const iron = new THREE.MeshStandardMaterial({ color: 0x8a1c16, roughness: 0.45, metalness: 0.25 });
  const lid = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.5, metalness: 0.3 });
  const zebraNS = new THREE.BoxGeometry(2.4, 0.01, 0.28);
  const zebraEW = new THREE.BoxGeometry(0.28, 0.01, 2.4);
  for (const t of city.tiles) {
    if (!isPaved(t.kind) || !isBuilt(t)) continue;
    const n = roadNeighbors(city, t.x, t.z);
    const xing = isXingN(n);
    const p = cellToWorld(t.x, t.z);
    const y = terrainHeight(p.x, p.z);
    const toward = [];
    if (!xing) {
      if (n.n && isXingN(roadNeighbors(city, t.x, t.z + 1))) toward.push("n");
      if (n.s && isXingN(roadNeighbors(city, t.x, t.z - 1))) toward.push("s");
      if (n.e && isXingN(roadNeighbors(city, t.x + 1, t.z))) toward.push("e");
      if (n.w && isXingN(roadNeighbors(city, t.x - 1, t.z))) toward.push("w");
    }
    for (const dir of toward) {
      const jx = t.x + (dir === "e" ? 1 : dir === "w" ? -1 : 0);
      const jz = t.z + (dir === "n" ? 1 : dir === "s" ? -1 : 0);
      if (seawardDir(city, jx, jz)) continue;
      for (let i = -2; i <= 2; i++) {
        const bar = new THREE.Mesh(dir === "n" || dir === "s" ? zebraNS : zebraEW, stripe);
        const along = 2.4;
        bar.position.set(
          p.x + (dir === "e" ? along : dir === "w" ? -along : i * 0.38),
          y + 0.1,
          p.z + (dir === "n" ? along : dir === "s" ? -along : i * 0.38)
        );
        root.add(bar);
      }
    }
    if (xing) continue;
    if (hash(t.x * 3.1, t.z * 2.7) > 0.82) {
      const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.55, 6), iron);
      hyd.position.set(p.x + 3.55, y + 0.32, p.z + 3.4);
      hyd.castShadow = true;
      root.add(hyd);
    }
    if (hash(t.x * 1.4, t.z * 4.2) > 0.88) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10), lid);
      hole.position.set(p.x + 0.35, y + 0.1, p.z - 0.25);
      root.add(hole);
    }
    if (hash(t.x * 2.6, t.z * 1.9) > 0.86) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 0.55, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a3e36, roughness: 0.55, metalness: 0.18 })
      );
      can.position.set(p.x + 3.4, y + 0.34, p.z - 3.35);
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
      post.position.set(px, w.y + 0.64, w.cz - 3.72);
      post.castShadow = true;
      root.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w.len * 0.9, 0.045, 0.045), iron);
    bar.position.set(w.cx, w.y + 1.08, w.cz - 3.72);
    root.add(bar);
    const nBollard = Math.max(2, Math.floor(w.len / 3.2));
    for (let i = 0; i < nBollard; i++) {
      const u = nBollard === 1 ? 0.5 : i / (nBollard - 1);
      const bx = w.cx - w.len * 0.42 + u * w.len * 0.84;
      const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 6), iron);
      bol.position.set(bx, w.y + 0.32, w.cz - 3.55);
      root.add(bol);
    }
  }
}

function addLamps(root, city, hRuns, vRuns) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.55, metalness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xffc070,
    emissiveIntensity: 0.2,
  });
  const place = (x, z, ox, oz) => {
    if (!inBounds(x, z)) return;
    if (isXingN(roadNeighbors(city, x, z))) return;
    const p = cellToWorld(x, z);
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), poleMat);
    pole.position.y = 2.3;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), poleMat);
    arm.position.set(0.4, 4.25, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bulbMat);
    bulb.position.set(0.78, 4.12, 0);
    bulb.userData.lamp = true;
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 14),
      new THREE.MeshBasicMaterial({
        color: 0xffc070,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0.55, 0.06, 0);
    glow.userData.lampGlow = true;
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffe2b0,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0.78, 4.14, 0);
    halo.userData.lampGlow = true;
    g.add(pole, arm, bulb, glow, halo);
    g.position.set(p.x + ox, terrainHeight(p.x + ox, p.z + oz), p.z + oz);
    root.add(g);
  };
  for (const run of hRuns) {
    for (let x = run.a; x <= run.b; x += 2) {
      place(x, run.k, 0.12, 3.62);
    }
  }
  for (const run of vRuns) {
    for (let z = run.a; z <= run.b; z += 2) {
      place(run.k, z, 3.62, 0.12);
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
  const pierAt = (x, z) => tileAt(city, x, z)?.kind === "pier";
  const xRuns = collectRuns(city, pierAt, "x");
  const zRuns = collectRuns(city, pierAt, "z");
  const runs = [
    ...xRuns.filter((r) => !coveredByPerp(r, zRuns)),
    ...zRuns.filter((r) => r.b > r.a),
  ];
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.72 });
  const cleatMat = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.35, metalness: 0.55 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.8 });
  const fenderMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xffc070,
    emissiveIntensity: 0.4,
  });
  const shedMat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["wood_dock.jpg"], [2, 2]),
    color: 0xb08a62,
    roughness: 0.82,
  });
  for (const run of runs) {
    const w = runWorld(run);
    const ns = run.axis === "z";
    const deckW = 7.2;
    const deck = new THREE.Mesh(
      ns ? new THREE.BoxGeometry(deckW, 0.22, w.len - 0.2) : new THREE.BoxGeometry(w.len - 0.2, 0.22, deckW),
      wood
    );
    deck.position.set(w.cx, 0.28, w.cz);
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);
    const half = deckW * 0.48;
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        ns ? new THREE.BoxGeometry(0.1, 0.12, w.len - 0.35) : new THREE.BoxGeometry(w.len - 0.35, 0.12, 0.1),
        railMat
      );
      rail.position.set(w.cx + (ns ? side * half : 0), 1.12, w.cz + (ns ? 0 : side * half));
      root.add(rail);
      const kick = new THREE.Mesh(
        ns ? new THREE.BoxGeometry(0.12, 0.14, w.len - 0.25) : new THREE.BoxGeometry(w.len - 0.25, 0.14, 0.12),
        railMat
      );
      kick.position.set(w.cx + (ns ? side * half : 0), 0.42, w.cz + (ns ? 0 : side * half));
      root.add(kick);
    }
    const count = Math.max(3, run.b - run.a + 2);
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const px = ns ? w.cx : w.cx - w.len * 0.46 + u * w.len * 0.92;
      const pz = ns ? w.cz - w.len * 0.46 + u * w.len * 0.92 : w.cz;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.35, 6), postMat);
        post.position.set(ns ? px + side * half : px, 0.15, ns ? pz : pz + side * half);
        post.castShadow = true;
        root.add(post);
      }
      if (i % 2 === 0) {
        const lx = ns ? px + half : px;
        const lz = ns ? pz : pz + half;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 5), postMat);
        pole.position.set(lx, 1.55, lz);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), lampMat);
        bulb.position.set(lx, 2.72, lz);
        bulb.userData.lamp = true;
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry(1.35, 10),
          new THREE.MeshBasicMaterial({
            color: 0xffc070,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
          })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(lx, 0.42, lz);
        glow.userData.lampGlow = true;
        root.add(pole, bulb, glow);
      }
    }
    const cleatN = Math.max(3, Math.floor(w.len / 4.2));
    for (let i = 0; i < cleatN; i++) {
      const u = cleatN === 1 ? 0.5 : i / (cleatN - 1);
      const cx = ns ? w.cx + 2.2 : w.cx - w.len * 0.4 + u * w.len * 0.8;
      const cz = ns ? w.cz - w.len * 0.4 + u * w.len * 0.8 : w.cz + 2.2;
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.16), cleatMat);
      cleat.position.set(cx, 0.42, cz);
      root.add(cleat);
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.85, 6), fenderMat);
      fender.position.set(ns ? w.cx + half + 0.08 : cx, 0.08, ns ? cz : w.cz + half + 0.08);
      root.add(fender);
      if (i % 2 === 0) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 0.55), crateMat);
        crate.position.set(cx - 0.7, 0.54, cz - 0.15);
        crate.castShadow = true;
        root.add(crate);
      }
    }
    const inland = ns ? w.cz + w.len * 0.38 : w.cx + w.len * 0.38;
    const shed = new THREE.Mesh(new THREE.BoxGeometry(ns ? 2.6 : 2.2, 1.85, ns ? 2.2 : 2.6), shedMat);
    shed.position.set(ns ? w.cx - 1.4 : inland, 1.18, ns ? inland : w.cz - 1.4);
    shed.castShadow = true;
    root.add(shed);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(ns ? 2.85 : 2.45, 0.12, ns ? 2.45 : 2.85),
      new THREE.MeshStandardMaterial({ color: 0x3a322c, roughness: 0.7 })
    );
    roof.position.copy(shed.position);
    roof.position.y = 2.18;
    root.add(roof);
  }
  return root;
}

export function streetSetback(city, t) {
  let ox = 0;
  let oz = 0;
  const pull = t.kind === "house" ? 1.85 : t.kind === "shop" || t.kind === "market" ? 0.85 : 0.55;
  if (isPavedHere(city, t.x, t.z + 1)) oz -= pull;
  if (isPavedHere(city, t.x, t.z - 1)) oz += pull;
  if (isPavedHere(city, t.x + 1, t.z)) ox -= pull;
  if (isPavedHere(city, t.x - 1, t.z)) ox += pull;
  return { ox, oz };
}
