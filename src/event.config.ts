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

/** Guest characters a guest can pick after saying yes. Ids are validated on the server. */
export const CHARACTER_IDS = ["sunny", "sky", "fern", "plum", "mint", "sand"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export const LIMITS = {
  nameMax: 40,
  publicNameMax: 20,
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
