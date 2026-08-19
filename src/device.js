export const GFX_TIERS = {
  high: {
    pixelRatio: 1.35,
    shadow: 1024,
    water: 512,
    antialias: false,
    trees: 0.72,
    traffic: 0.72,
    people: 0.7,
    sway: true,
    land: 96,
  },
  mid: {
    pixelRatio: 1.15,
    shadow: 512,
    water: 256,
    antialias: false,
    trees: 0.45,
    traffic: 0.5,
    people: 0.35,
    sway: false,
    land: 80,
  },
  low: {
    pixelRatio: 1,
    shadow: 512,
    water: 160,
    antialias: false,
    trees: 0.28,
    traffic: 0.32,
    people: 0,
    sway: false,
    land: 64,
  },
};

function autoTier() {
  const ua = navigator.userAgent || "";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = innerWidth < 820;
  const phoneUA = /Mobi|Android.*Mobile|iPhone|iPod/i.test(ua);
  const tabletUA = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
  const touch = coarse || "ontouchstart" in window;
  const saveData = !!navigator.connection?.saveData;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const dpr = devicePixelRatio || 1;
  const phone = phoneUA || (touch && narrow && !tabletUA);
  const tablet = tabletUA || (touch && innerWidth >= 768 && innerWidth < 1200 && !phoneUA);
  const hugePixel = innerWidth * innerHeight * Math.min(dpr, 2) > 3_100_000;
  if (phone || saveData || mem <= 4 || cores <= 4) return "low";
  if (tablet || mem <= 6 || cores <= 6 || hugePixel) return "mid";
  return "high";
}

export function gfxPref() {
  try {
    return localStorage.getItem("harborline-gfx") || "auto";
  } catch {
    return "auto";
  }
}

export function setGfxPref(pref) {
  try {
    localStorage.setItem("harborline-gfx", pref);
  } catch {
    /* ignore */
  }
}

export function detectDevice() {
  const ua = navigator.userAgent || "";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = innerWidth < 820;
  const phoneUA = /Mobi|Android.*Mobile|iPhone|iPod/i.test(ua);
  const tabletUA = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
  const touch = coarse || "ontouchstart" in window;
  const phone = phoneUA || (touch && narrow && !tabletUA);
  const tablet = tabletUA || (touch && innerWidth >= 768 && innerWidth < 1200 && !phoneUA);
  const pref = gfxPref();
  const auto = autoTier();
  const quality = pref === "auto" ? auto : GFX_TIERS[pref] ? pref : auto;
  const tier = GFX_TIERS[quality];
  const dpr = Math.min(devicePixelRatio || 1, tier.pixelRatio);
  return {
    touch: touch || phone || tablet,
    phone,
    tablet,
    quality,
    pref,
    auto,
    bloom: false,
    ssao: false,
    ...tier,
    pixelRatio: dpr,
  };
}
