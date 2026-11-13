/**
 * Same-device memory. Every localStorage call is wrapped: private windows and blocked
 * storage must never break the invitation.
 */
import type { CharacterId } from "./event.config.ts";

const FOUND_KEY = "fj.found.v1";
const RSVP_KEY = "fj.rsvp.v1";

export interface LocalRsvp {
  /** Response id, generated on this device and reused for every retry and change. */
  id: string;
  /** Private edit token. Only its hash is stored on the server. Never sent anywhere public. */
  token: string;
  name: string;
  status: "yes" | "no";
  partySize: number;
  character: CharacterId | null;
  showName: boolean;
  /** True once the server has confirmed this response. */
  saved: boolean;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: carry on in memory */
  }
}

export function hasFound(): boolean {
  return read(FOUND_KEY) === "1";
}

export function markFound(): void {
  write(FOUND_KEY, "1");
}

let memory: LocalRsvp | null = null;

export function loadRsvp(): LocalRsvp | null {
  if (memory) return memory;
  const raw = read(RSVP_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalRsvp>;
    if (typeof v.id !== "string" || typeof v.token !== "string") return null;
    memory = {
      id: v.id,
      token: v.token,
      name: typeof v.name === "string" ? v.name : "",
      status: v.status === "no" ? "no" : "yes",
      partySize: typeof v.partySize === "number" ? v.partySize : 1,
      character: (v.character as CharacterId | null) ?? null,
      showName: v.showName === true,
      saved: v.saved === true,
    };
    return memory;
  } catch {
    return null;
  }
}

export function storeRsvp(r: LocalRsvp): void {
  memory = r;
  write(RSVP_KEY, JSON.stringify(r));
}

export function clearRsvp(): void {
  memory = null;
  write(RSVP_KEY, null);
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newIdentity(): { id: string; token: string } {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${randomHex(4)}-${randomHex(2)}-4${randomHex(2).slice(1)}-a${randomHex(2).slice(1)}-${randomHex(6)}`;
  return { id, token: randomHex(32) };
}
