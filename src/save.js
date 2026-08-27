import { serializeCity, applySave } from "./city.js";

const KEY = "harborline-save-v5";

export function saveCity(city) {
  if (!city) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(serializeCity(city)));
  } catch {
    /* quota / private mode */
  }
}

/** Write the live city on tab hide / reload so Continue matches the HUD. */
export function bindSaveFlush(city) {
  const flush = () => saveCity(city);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", flush);
  addEventListener("beforeunload", flush);
  return flush;
}

export function loadCity(city) {
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    return applySave(city, JSON.parse(raw));
  } catch {
    return false;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

export function hasSave() {
  return !!localStorage.getItem(KEY);
}
