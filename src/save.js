import { serializeCity, applySave } from "./city.js";

const KEY = "harborline-save-v1";

export function saveCity(city) {
  localStorage.setItem(KEY, JSON.stringify(serializeCity(city)));
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
