/**
 * RSVP logic, kept free of Netlify specifics so it can be unit tested with an in-memory store.
 * Private data (names, token hashes, ids) never leaves through the public attendee list.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { EVENT, LIMITS, normalizeLook, parsePet, randomLook, randomPet, type Companion } from "../../src/event.config.ts";

export interface KV {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface StoredResponse {
  id: string;
  eventId: string;
  /** sha256 of the private edit token. The token itself is never stored. */
  tokenHash: string;
  name: string;
  status: "yes" | "no";
  partySize: number;
  /** Look code (see src/event.config.ts). */
  character: string | null;
  publicName: string | null;
  /** The people this guest is bringing, shown as named pets. */
  companions?: Companion[];
  /** Where the guest put their character, as two 0–1 numbers. */
  pos?: [number, number] | null;
  /** How many park secrets this guest has found (reported by their device). */
  secrets?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAttendees {
  totalComing: number;
  guests: PublicGuest[];
}

export interface PublicGuest {
  /** Short hash of the response id, so a device can spot its own character. Not a secret. */
  key: string;
  character: string;
  displayName?: string;
  pos?: [number, number];
  pets?: Companion[];
  secrets?: number;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const THROTTLE_MAX = 60;
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{32,128}$/i;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const guestKey = (id: string) => sha256(`guest:${id.toLowerCase()}`).slice(0, 12);

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

async function allResponses(kv: KV): Promise<StoredResponse[]> {
  const keys = await kv.list("responses/");
  const rows = await Promise.all(keys.map((k) => kv.get(k)));
  return (rows.filter(Boolean) as StoredResponse[])
    .filter((r) => r.eventId === EVENT.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function toPublic(rows: StoredResponse[], forId?: string): { attendees: PublicAttendees; you: number | null } {
  let totalComing = 0;
  let you: number | null = null;
  const guests: PublicAttendees["guests"] = [];
  for (const r of rows) {
    if (r.status !== "yes") continue;
    totalComing += r.partySize;
    if (!r.character) continue;
    if (r.id === forId) you = guests.length;
    const g: PublicGuest = { key: guestKey(r.id), character: normalizeLook(r.character) ?? "1.2.0.1.0" };
    if (r.publicName) g.displayName = r.publicName;
    if (r.pos) g.pos = r.pos;
    if (r.secrets) g.secrets = r.secrets;
    if (r.companions?.length) g.pets = r.companions;
    guests.push(g);
  }
  return { attendees: { totalComing, guests }, you };
}

/** Allows at most 60 writes per IP per 10 minutes (changing a look or moving a character each count as one). */
async function throttled(kv: KV, ip: string, now: number): Promise<boolean> {
  const key = `throttle/${sha256(`${EVENT.id}:${ip}`).slice(0, 24)}`;
  const cur = (await kv.get(key)) as { start: number; count: number } | null;
  const fresh = !cur || typeof cur.start !== "number" || now - cur.start > THROTTLE_WINDOW_MS;
  const next = fresh ? { start: now, count: 1 } : { start: cur.start, count: cur.count + 1 };
  if (next.count > THROTTLE_MAX) return true;
  await kv.set(key, next);
  return false;
}

/** Creates or updates one response. Sending the same id and token again updates the same record. */
export async function handleRsvp(input: unknown, ip: string, kv: KV, now = Date.now()): Promise<Reply> {
  if (!EVENT.published) return { status: 503, body: { error: "not_published" } };
  if (!input || typeof input !== "object") return { status: 400, body: { error: "invalid_body" } };
  const b = input as Record<string, unknown>;

  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return { status: 400, body: { error: "invalid_id" } };
  if (typeof b.token !== "string" || !TOKEN_RE.test(b.token)) return { status: 400, body: { error: "invalid_token_format" } };
  const name = cleanText(b.name, LIMITS.nameMax);
  if (!name) return { status: 400, body: { error: "invalid_name" } };
  if (b.status !== "yes" && b.status !== "no") return { status: 400, body: { error: "invalid_status" } };
  const maxParty = EVENT.plusOnesAllowed ? EVENT.maxPartySize : 1;
  if (typeof b.partySize !== "number" || !Number.isInteger(b.partySize) || b.partySize < 1 || b.partySize > maxParty) {
    return { status: 400, body: { error: "invalid_party_size" } };
  }
  let character: string | null = null;
  if (b.character !== null && b.character !== undefined) {
    character = normalizeLook(b.character);
    if (!character) return { status: 400, body: { error: "invalid_character" } };
  }

  // The people a guest brings must be named, and each one appears as a pet. Not optional.
  const companions: Companion[] = [];
  if (b.status === "yes" && b.partySize > 1) {
    if (!Array.isArray(b.companions) || b.companions.length !== b.partySize - 1) {
      return { status: 400, body: { error: "companions_required" } };
    }
    for (const c of b.companions as unknown[]) {
      const row = (c ?? {}) as Record<string, unknown>;
      const cname = cleanText(row.name, LIMITS.companionNameMax);
      if (!cname) return { status: 400, body: { error: "invalid_companion_name" } };
      let pet = randomPet();
      if (row.pet !== null && row.pet !== undefined) {
        const parsed = parsePet(row.pet);
        if (!parsed) return { status: 400, body: { error: "invalid_pet" } };
        pet = parsed.join(".");
      }
      companions.push({ name: cname, pet });
    }
  }

  let pos: [number, number] | null = null;
  if (b.pos !== null && b.pos !== undefined) {
    const p = b.pos as unknown[];
    const ok = Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
    if (!ok) return { status: 400, body: { error: "invalid_position" } };
    pos = [Math.round((p[0] as number) * 1000) / 1000, Math.round((p[1] as number) * 1000) / 1000];
  }

  let secrets = 0;
  if (b.secrets !== null && b.secrets !== undefined) {
    if (typeof b.secrets !== "number" || !Number.isInteger(b.secrets) || b.secrets < 0 || b.secrets > LIMITS.secretsTotal) {
      return { status: 400, body: { error: "invalid_secrets" } };
    }
    secrets = b.secrets;
  }

  // Everyone who says yes appears in the park with a character and their first name. It is not optional:
  // a missing character is filled in at random, and the public name always comes from the name given.
  let publicName: string | null = null;
  if (b.status === "yes") {
    if (!character) character = randomLook();
    publicName = name.split(" ")[0].slice(0, LIMITS.publicNameMax);
  }

  if (await throttled(kv, ip, now)) return { status: 429, body: { error: "rate_limited" } };

  const id = b.id.toLowerCase();
  const key = `responses/${id}`;
  const tokenHash = sha256(b.token.toLowerCase());
  const existing = (await kv.get(key)) as StoredResponse | null;
  if (existing && !sameHash(existing.tokenHash, tokenHash)) return { status: 403, body: { error: "invalid_token" } };

  const stamp = new Date(now).toISOString();
  const record: StoredResponse = {
    id,
    eventId: EVENT.id,
    tokenHash,
    name,
    status: b.status,
    partySize: b.partySize,
    character,
    publicName,
    companions,
    pos,
    // A count never goes down, so a second device or cleared storage can't undo it.
    secrets: Math.max(secrets, existing?.secrets ?? 0),
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  await kv.set(key, record);

  const rows = (await allResponses(kv)).filter((r) => r.id !== id);
  rows.push(record);
  rows.sort((a, c) => a.createdAt.localeCompare(c.createdAt) || a.id.localeCompare(c.id));
  const { attendees, you } = toPublic(rows, id);
  return { status: 200, body: { ok: true, attendees, you } };
}

/** Public data: the headcount, plus a character and first name for each guest who said yes. */
export async function publicAttendees(kv: KV): Promise<PublicAttendees> {
  return toPublic(await allResponses(kv)).attendees;
}

/** Host view: everything except the token hash. */
export async function hostSummary(kv: KV) {
  const rows = await allResponses(kv);
  const responses = rows.map(({ tokenHash: _hash, ...rest }) => rest);
  const yes = rows.filter((r) => r.status === "yes");
  return {
    event: { title: EVENT.title, id: EVENT.id },
    totalComing: yes.reduce((n, r) => n + r.partySize, 0),
    yesCount: yes.length,
    noCount: rows.length - yes.length,
    responses,
  };
}

export function adminKeyMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  return sameHash(sha256(given), sha256(expected));
}
