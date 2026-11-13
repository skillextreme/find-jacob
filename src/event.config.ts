/**
 * Single source of truth for the event.
 * The invitation, the calendar exports and the Netlify functions all read from here.
 * To change a detail, edit this file and push.
 */
export interface EventConfig {
  id: string;
  title: string;
  host: string;
  /** Start and end as UTC instants. 3:00–6:00 pm India time = 09:30–12:30 UTC. */
  startUtc: string;
  endUtc: string;
  /** IANA time zone used to display the date and time. */
  timeZone: string;
  timeZoneLabel: string;
  venue: string;
  meetingPoint: string;
  /** Leave empty until there is a map link. The map button stays hidden while empty. */
  mapUrl: string;
  plan: string;
  bring: string;
  /** Empty = not shown. */
  rainPlan: string;
  /** Empty = not shown. */
  rsvpDeadline: string;
  plusOnesAllowed: boolean;
  maxPartySize: number;
  /** How a guest reaches the host if something goes wrong. */
  hostContact: string;
  siteUrl: string;
  published: boolean;
}

export const EVENT: EventConfig = {
  id: "jacob-birthday-2026",
  title: "Jacob's Birthday in the Park",
  host: "Jacob",
  startUtc: "2026-11-15T09:30:00Z",
  endUtc: "2026-11-15T12:30:00Z",
  timeZone: "Asia/Kolkata",
  timeZoneLabel: "India time",
  venue: "Cubbon Park, Bengaluru",
  meetingPoint: "Exact spot will be shared on WhatsApp.",
  mapUrl: "",
  plan: "An afternoon hanging out in the park.",
  bring: "Come in active wear, because we might play a few running games.",
  rainPlan: "",
  rsvpDeadline: "",
  plusOnesAllowed: true,
  maxPartySize: 5,
  hostContact: "Message Jacob on WhatsApp",
  siteUrl: "https://find-jacob.netlify.app",
  published: true,
};

/**
 * A guest's look is five small numbers joined by dots: skin.hairStyle.hairColour.top.bottoms
 * (for example "2.4.0.3.1"). A pet's look is kind.colour (for example "1.3").
 * The counts below say how many choices each part has; the drawings live in src/art.ts.
 */
export const LOOK_PARTS = [6, 7, 5, 8, 6] as const;
export const PET_PARTS = [3, 5] as const;

/** Looks from the first version of the site, kept so older saved responses still draw. */
const LEGACY_LOOKS: Record<string, string> = {
  sunny: "1.1.1.0.1",
  sky: "4.5.0.1.2",
  fern: "2.4.0.2.3",
  plum: "0.3.2.3.4",
  mint: "3.6.0.4.0",
  sand: "1.2.2.5.5",
};

function parseCode(code: unknown, parts: readonly number[]): number[] | null {
  if (typeof code !== "string" || code.length > 24) return null;
  const nums = code.split(".").map((n) => (/^\d{1,2}$/.test(n) ? Number(n) : -1));
  if (nums.length !== parts.length) return null;
  return nums.every((n, i) => n >= 0 && n < parts[i]) ? nums : null;
}

/** Returns the look as numbers, or null if the code isn't a valid look. */
export function parseLook(code: unknown): number[] | null {
  if (typeof code === "string" && code in LEGACY_LOOKS) return parseCode(LEGACY_LOOKS[code], LOOK_PARTS);
  return parseCode(code, LOOK_PARTS);
}
export function parsePet(code: unknown): number[] | null {
  return parseCode(code, PET_PARTS);
}
/** Canonical look code, or null. */
export function normalizeLook(code: unknown): string | null {
  return parseLook(code)?.join(".") ?? null;
}
const pick = (parts: readonly number[]) => parts.map((n) => Math.floor(Math.random() * n)).join(".");
export const randomLook = () => pick(LOOK_PARTS);
export const randomPet = () => pick(PET_PARTS);

/** Someone a guest is bringing. They appear in the park as a named pet beside the guest. */
export interface Companion {
  name: string;
  pet: string;
}

export const LIMITS = {
  nameMax: 40,
  publicNameMax: 20,
  companionNameMax: 20,
  /** Hidden secrets in the park (see src/eggs.ts). */
  secretsTotal: 7,
  /** Individual characters drawn in the park at once. The count stays accurate above this. */
  maxVisibleGuests: 24,
} as const;

function parts(iso: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: EVENT.timeZone, ...opts }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  return out;
}

/** "Sunday 15 November 2026" in the event's time zone. */
export function formatEventDate(): string {
  const p = parts(EVENT.startUtc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

function clock(iso: string): { time: string; period: string } {
  const p = parts(iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return { time: `${p.hour}:${p.minute}`, period: (p.dayPeriod ?? "").toLowerCase() };
}

/** "3:00–6:00 pm" in the event's time zone. */
export function formatEventTime(): string {
  const a = clock(EVENT.startUtc);
  const b = clock(EVENT.endUtc);
  return a.period === b.period ? `${a.time}–${b.time} ${b.period}` : `${a.time} ${a.period}–${b.time} ${b.period}`;
}
