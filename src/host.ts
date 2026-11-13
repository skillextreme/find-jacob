/** Host view: lists every response. Needs the ADMIN_KEY set in Netlify, passed as ?key=... */
import { EVENT } from "./event.config.ts";

interface Row {
  name: string;
  status: "yes" | "no";
  partySize: number;
  character: string | null;
  publicName: string | null;
  updatedAt: string;
}
interface Summary {
  totalComing: number;
  yesCount: number;
  noCount: number;
  responses: Row[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const form = $<HTMLFormElement>("key-form");
const input = $<HTMLInputElement>("key-input");

function askForKey(message: string): void {
  statusEl.textContent = message;
  form.hidden = false;
  $("table-wrap").hidden = true;
  $("total").hidden = true;
}

function cell(text: string, cls = ""): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = text; // guest-entered text is always plain text
  if (cls) td.className = cls;
  return td;
}

async function load(key: string): Promise<void> {
  statusEl.textContent = "Loading…";
  let res: Response;
  try {
    res = await fetch(`/api/host?key=${encodeURIComponent(key)}`, { headers: { accept: "application/json" } });
  } catch {
    askForKey("Couldn't reach the server. Check your connection and try again.");
    return;
  }
  if (res.status === 401) return askForKey("That key didn't match. Check the ADMIN_KEY you set in Netlify.");
  if (res.status === 503) return askForKey("ADMIN_KEY isn't set in Netlify yet. Add it under Site configuration → Environment variables, then redeploy.");
  if (!res.ok) return askForKey(`The server returned an error (${res.status}). Try again in a moment.`);
  const data = (await res.json()) as Summary;

  form.hidden = true;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: EVENT.timeZone });
  const body = $("rows");
  body.replaceChildren();
  for (const r of data.responses) {
    const tr = document.createElement("tr");
    tr.append(
      cell(r.name),
      cell(r.status === "yes" ? "Yes" : "No"),
      cell(r.status === "yes" ? String(r.partySize) : "–", "num"),
      cell(r.character ? (r.publicName ? `${r.character} (shown as ${r.publicName})` : `${r.character} (name hidden)`) : "–"),
      cell(fmt.format(new Date(r.updatedAt))),
    );
    body.append(tr);
  }
  statusEl.textContent = data.responses.length
    ? `${EVENT.title}. ${data.yesCount} said yes, ${data.noCount} said no. Times are ${EVENT.timeZoneLabel}.`
    : "No responses yet.";
  $("total").hidden = false;
  $("total").textContent = `${data.totalComing} ${data.totalComing === 1 ? "person" : "people"} coming in total`;
  $("table-wrap").hidden = data.responses.length === 0;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value.trim()) void load(input.value.trim());
});

const fromUrl = new URLSearchParams(window.location.search).get("key");
if (fromUrl) void load(fromUrl);
else askForKey("Enter your host key to see responses.");
