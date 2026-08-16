import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const propsDir = path.resolve("assets/props");
const files = ["oak.jpg", "pine.jpg"];

function sampleBg(data, w, h, ch) {
  const pts = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
    [w >> 1, 2],
    [2, h >> 1],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) {
    const i = (y * w + x) * ch;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = pts.length;
  return [r / n, g / n, b / n];
}

for (const file of files) {
  const src = path.join(propsDir, file);
  if (!fs.existsSync(src)) {
    console.log("skip missing", file);
    continue;
  }
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const [cr, cg, cb] = sampleBg(data, w, h, ch);
  const out = Buffer.alloc(w * h * 4);
  let trans = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const o = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const dist = Math.hypot(r - cr, g - cg, b - cb);
      const pink = r > 160 && g < 130 && b > 110 && r - g > 60;
      let a = 255;
      if (dist < 55 || (pink && dist < 90)) {
        a = 0;
        trans++;
      } else if (dist < 85 || (pink && dist < 120)) {
        a = Math.round(((dist - 55) / 40) * 255);
      }
      if (a > 0 && pink) {
        const spill = Math.max(0, Math.min(r, b) - g);
        out[o] = Math.max(0, r - spill * 0.7);
        out[o + 1] = g;
        out[o + 2] = Math.max(0, b - spill * 0.7);
      } else {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
      out[o + 3] = a;
    }
  }
  const dest = path.join(propsDir, file.replace(".jpg", ".png"));
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(dest);
  console.log(
    "wrote",
    dest,
    w,
    "x",
    h,
    "bg",
    cr.toFixed(0),
    cg.toFixed(0),
    cb.toFixed(0),
    "trans",
    (trans / (w * h)).toFixed(3)
  );
}
