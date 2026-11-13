import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { buildIcs, icsFileName } from "./src/calendar.ts";
import { EVENT, formatEventDate, formatEventTime } from "./src/event.config.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Fills the no-JavaScript fallback from the event config, so it never drifts from the invitation. */
function eventFallback(): Plugin {
  const values: Record<string, string> = {
    EVENT_TITLE: EVENT.title,
    EVENT_DATE: formatEventDate(),
    EVENT_TIME: formatEventTime(),
    EVENT_TZ: EVENT.timeZoneLabel,
    EVENT_VENUE: EVENT.venue,
    EVENT_MEETING: EVENT.meetingPoint,
    EVENT_PLAN: EVENT.plan,
    EVENT_BRING: EVENT.bring,
  };
  return {
    name: "event-fallback",
    transformIndexHtml(html) {
      return html.replace(/%(EVENT_[A-Z]+)%/g, (m, k: string) => (k in values ? esc(values[k]) : m));
    },
  };
}

/**
 * Publishes the calendar file as a real file at /<event-id>.ics, built from the event config.
 * A normal https link is the most dependable way to add an event on phones.
 */
function calendarFile(): Plugin {
  return {
    name: "calendar-file",
    configureServer(server) {
      server.middlewares.use(`/${icsFileName()}`, (_req, res) => {
        res.setHeader("content-type", "text/calendar; charset=utf-8");
        res.end(buildIcs());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: icsFileName(), source: buildIcs() });
    },
  };
}

export default defineConfig({
  plugins: [eventFallback(), calendarFile()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        host: resolve(import.meta.dirname, "host.html"),
      },
    },
  },
});
