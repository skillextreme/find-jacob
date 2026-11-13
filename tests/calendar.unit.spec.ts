import { expect, test } from "@playwright/test";
import { buildIcs, escapeIcsText, googleCalendarUrl, toCalendarStamp } from "../src/calendar.ts";
import { EVENT, formatEventDate, formatEventTime } from "../src/event.config.ts";

test("event config shows the confirmed date and time in India time", () => {
  expect(formatEventDate()).toBe("Sunday 15 November 2026");
  expect(formatEventTime()).toBe("3:00–6:00 pm");
  expect(EVENT.timeZone).toBe("Asia/Kolkata");
  expect(EVENT.mapUrl).toBe("");
});

test("ics file has the right start, end, summary and location", () => {
  const ics = buildIcs();
  const lines = ics.split("\r\n");
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines).toContain("DTSTART:20261115T093000Z");
  expect(lines).toContain("DTEND:20261115T123000Z");
  expect(lines).toContain("SUMMARY:Jacob's Birthday in the Park");
  expect(lines).toContain("LOCATION:Cubbon Park\\, Bengaluru");
  expect(lines).toContain("UID:jacob-birthday-2026@find-jacob.netlify.app");
  expect(lines).toContain("END:VEVENT");
  expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
});

test("ics uses CRLF line endings, folds long lines and stays stable", () => {
  const ics = buildIcs();
  expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  const enc = new TextEncoder();
  for (const line of ics.split("\r\n")) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
  expect(buildIcs()).toBe(ics);
  const unfolded = ics.replace(/\r\n /g, "");
  expect(unfolded).toContain("active wear\\, because");
  expect(unfolded).toContain("Exact spot will be shared on WhatsApp.");
  expect(unfolded).not.toMatch(/rain/i);
});

test("ics text escaping", () => {
  expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
  expect(toCalendarStamp("2026-11-15T09:30:00Z")).toBe("20261115T093000Z");
});

test("google calendar link matches the config", () => {
  const url = new URL(googleCalendarUrl());
  expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
  expect(url.searchParams.get("dates")).toBe("20261115T093000Z/20261115T123000Z");
  expect(url.searchParams.get("text")).toBe("Jacob's Birthday in the Park");
  expect(url.searchParams.get("location")).toBe("Cubbon Park, Bengaluru");
  expect(url.searchParams.get("ctz")).toBe("Asia/Kolkata");
});
