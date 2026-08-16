export function detectDevice() {
  const ua = navigator.userAgent || "";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = innerWidth < 820;
  const phoneUA = /Mobi|Android.*Mobile|iPhone|iPod/i.test(ua);
  const tabletUA = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
  const touch = coarse || "ontouchstart" in window;
  const saveData = !!navigator.connection?.saveData;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const phone = phoneUA || (touch && narrow && !tabletUA);
  const tablet = tabletUA || (touch && innerWidth >= 768 && innerWidth < 1200 && !phoneUA);
  const low = phone || saveData || mem <= 4 || cores <= 4;
  const mid = !low && (tablet || mem <= 6);
  const quality = low ? "low" : mid ? "mid" : "high";
  return {
    touch: touch || phone || tablet,
    phone,
    tablet,
    quality,
    pixelRatio: quality === "low" ? Math.min(devicePixelRatio || 1, 1.25) : Math.min(devicePixelRatio || 1, 2),
    shadow: quality === "high" ? 2048 : quality === "mid" ? 1536 : 1024,
    water: quality === "high" ? 1024 : quality === "mid" ? 512 : 256,
    ssao: false,
    bloom: quality !== "low",
    antialias: quality !== "low",
  };
}
