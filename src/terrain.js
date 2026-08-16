import * as THREE from "three";
import { ASSET_PATHS } from "./buildings.js";
import { CELL, SIZE, landField, shorelineWorldZ, terrainHeight } from "./city.js";

const SEG = 168;
const PAD = 2.4;

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export function createLandMesh(loadTex) {
  const minC = -PAD;
  const maxC = SIZE - 1 + PAD;
  const span = maxC - minC;
  const geo = new THREE.PlaneGeometry(span * CELL, span * CELL, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const half = ((SIZE - 1) / 2) * CELL;

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    let y = terrainHeight(wx, wz);
    const edge =
      Math.max(Math.abs(wx) - half - CELL * 0.2, Math.abs(wz) - half - CELL * 0.2);
    if (edge > 0) y -= edge * 0.35;
    pos.setY(i, y);

    const d = landField(wx, wz);
    const sand = 1 - smooth((d - 0.4) / 9);
    const conc = smooth((d - 2.2) / 4) * (1 - smooth((d - 8) / 7));
    const dirt = smooth((d - 6) / 10) * (1 - smooth((d - 26) / 16));
    const grass = smooth((d - 12) / 16);
    const sum = sand + conc + dirt + grass + 1e-4;
    colors[i * 3] = sand / sum;
    colors[i * 3 + 1] = grass / sum;
    colors[i * 3 + 2] = conc / sum;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const grass = loadTex(ASSET_PATHS["grass.jpg"], [1, 1]);
  const dirt = loadTex(ASSET_PATHS["dirt.jpg"], [1, 1]);
  const sand = loadTex(ASSET_PATHS["sand.jpg"], [1, 1]);
  const conc = loadTex(ASSET_PATHS["concrete.jpg"], [1, 1]);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02,
    vertexColors: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uDirt = { value: dirt };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uConc = { value: conc };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWP;
        uniform sampler2D uGrass;
        uniform sampler2D uDirt;
        uniform sampler2D uSand;
        uniform sampler2D uConc;`
      )
      .replace(
        "#include <color_fragment>",
        `
        vec2 uvA = vWP.xz * 0.092;
        vec2 uvB = vWP.xz * 0.027;
        vec3 sandC = texture2D(uSand, uvA * 1.28).rgb;
        vec3 dirtC = texture2D(uDirt, uvA * 1.04).rgb;
        vec3 grassC = mix(texture2D(uGrass, uvA).rgb, texture2D(uGrass, uvB).rgb, 0.38);
        vec3 concC = texture2D(uConc, uvA * 0.72).rgb;
        float dirtW = max(0.0, 1.0 - vColor.r - vColor.g - vColor.b);
        vec3 albedo = sandC * vColor.r + grassC * vColor.g + concC * vColor.b + dirtC * dirtW;
        float wet = smoothstep(0.1, -0.42, vWP.y);
        albedo *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = albedo;
        `
      );
  };
  mat.customProgramCacheKey = () => "harbor-ground-v2";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "land";
  return mesh;
}

export function createSeawallMesh(loadTex) {
  const N = 110;
  const minX = (-PAD - (SIZE - 1) / 2) * CELL;
  const maxX = (SIZE - 1 + PAD - (SIZE - 1) / 2) * CELL;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const wx = minX + (i / N) * (maxX - minX);
    const wz = shorelineWorldZ(wx);
    const d = landField(wx, wz);
    if (d < -10 || d > 14) continue;
    pts.push(new THREE.Vector3(wx, Math.max(terrainHeight(wx, wz), -0.05) + 0.02, wz + 0.8));
  }
  const west = [];
  for (let i = 0; i <= 28; i++) {
    const cz = 5 + (i / 28) * 16;
    const wx = (3 - (SIZE - 1) / 2) * CELL;
    const wz = (cz - (SIZE - 1) / 2) * CELL;
    west.push(new THREE.Vector3(wx, 0.08, wz));
  }

  const mat = new THREE.MeshStandardMaterial({
    map: loadTex(ASSET_PATHS["concrete.jpg"], [4, 1]),
    roughness: 0.86,
    metalness: 0.04,
    color: 0xd8d4cc,
  });
  const group = new THREE.Group();
  group.name = "seawall";
  if (pts.length > 2) group.add(ribbon(pts, 0.42, 0.78, mat));
  if (west.length > 2) group.add(ribbon(west, 0.42, 0.78, mat));
  return group;
}

function ribbon(pts, width, height, mat) {
  const n = pts.length;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const idx = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const hw = width * 0.5;
    const corners = [
      [p.x - nx * hw, p.y, p.z - nz * hw],
      [p.x + nx * hw, p.y, p.z + nz * hw],
      [p.x - nx * hw, p.y + height, p.z - nz * hw],
      [p.x + nx * hw, p.y + height, p.z + nz * hw],
    ];
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      pos[o] = corners[k][0];
      pos[o + 1] = corners[k][1];
      pos[o + 2] = corners[k][2];
      const uo = (i * 4 + k) * 2;
      uv[uo] = dist * 0.12;
      uv[uo + 1] = k < 2 ? 0 : 1;
    }
    if (i < n - 1) {
      const a = i * 4;
      const b = (i + 1) * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      idx.push(a, a + 2, b, b, a + 2, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
