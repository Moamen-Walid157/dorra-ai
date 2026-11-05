export const STUDIO_PASSWORD = "dorra-2026";

const OPEN = "dorra-open";
const KEY = "dorra-gemini-key";

export function isUnlocked() {
  return sessionStorage.getItem(OPEN) === "1";
}

export function unlock(password: string) {
  if (password !== STUDIO_PASSWORD) return false;
  sessionStorage.setItem(OPEN, "1");
  return true;
}

export function lockStudio() {
  sessionStorage.removeItem(OPEN);
}

export function readKey() {
  return localStorage.getItem(KEY)?.trim() || "";
}

export function saveKey(value: string) {
  localStorage.setItem(KEY, value.trim());
}

export function clearKey() {
  localStorage.removeItem(KEY);
}
