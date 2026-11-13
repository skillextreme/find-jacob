import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
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

export default defineConfig({
  plugins: [eventFallback()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        host: resolve(import.meta.dirname, "host.html"),
      },
    },
  },
});
