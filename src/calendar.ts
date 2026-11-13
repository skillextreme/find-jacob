/** Calendar exports. Everything comes from the event config, so they always match the invitation. */
import { EVENT, type EventConfig } from "./event.config.ts";

/** 2026-11-15T09:30:00Z -> 20261115T093000Z */
export function toCalendarStamp(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${isoUtc}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function description(ev: EventConfig): string {
  return [ev.plan, ev.bring, ev.meetingPoint, ev.rainPlan, ev.mapUrl ? `Map: ${ev.mapUrl}` : "", ev.siteUrl]
    .filter(Boolean)
    .join("\n");
}

/** Escapes text for an iCalendar property value (RFC 5545 section 3.3.11). */
export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, continuing with a leading space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(ev: EventConfig = EVENT): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Find Jacob//Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.id}@find-jacob.netlify.app`,
    // A fixed stamp keeps the file identical on every download, so re-imports update rather than duplicate.
    `DTSTAMP:${toCalendarStamp("2026-11-13T00:00:00Z")}`,
    `DTSTART:${toCalendarStamp(ev.startUtc)}`,
    `DTEND:${toCalendarStamp(ev.endUtc)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `LOCATION:${escapeIcsText(ev.venue)}`,
    `DESCRIPTION:${escapeIcsText(description(ev))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(ev: EventConfig = EVENT): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${toCalendarStamp(ev.startUtc)}/${toCalendarStamp(ev.endUtc)}`,
    details: description(ev),
    location: ev.venue,
    ctz: ev.timeZone,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function icsFileName(ev: EventConfig = EVENT): string {
  return `${ev.id}.ics`;
}

/** The calendar file is published next to the site at build time (see vite.config.ts). */
export function icsHref(ev: EventConfig = EVENT): string {
  return `/${icsFileName(ev)}`;
}
