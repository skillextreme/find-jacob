/**
 * Same-device memory. Every localStorage call is wrapped: private windows and blocked
 * storage must never break the invitation.
 */
import { normalizeLook, parsePet, type Companion } from "./event.config.ts";

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
  /** Look code. */
  character: string | null;
  /** People this guest is bringing, shown as pets. */
  companions: Companion[];
  /** Where the guest placed their character (0–1, 0–1), or null for the default spot. */
  pos: [number, number] | null;
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

const EGGS_KEY = "fj.eggs.v1";

/** Ids of the park secrets found on this device. */
export function loadEggs(): Set<string> {
  try {
    const raw = JSON.parse(read(EGGS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function storeEggs(found: Set<string>): void {
  write(EGGS_KEY, JSON.stringify([...found]));
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
      character: normalizeLook(v.character),
      companions: Array.isArray(v.companions)
        ? v.companions.filter((c) => c && typeof c.name === "string" && parsePet(c.pet)).map((c) => ({ name: c.name, pet: c.pet }))
        : [],
      pos: Array.isArray(v.pos) && v.pos.length === 2 && v.pos.every((n) => typeof n === "number") ? (v.pos as [number, number]) : null,
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

/** The public key of a response id: the same short hash the server puts on each park guest. */
export async function guestKey(id: string): Promise<string | null> {
  try {
    const data = new TextEncoder().encode(`guest:${id.toLowerCase()}`);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
  } catch {
    return null;
  }
}
