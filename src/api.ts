/** Thin client for the Netlify functions. The game and the invitation work without it. */
import type { Companion } from "./event.config.ts";

export interface PublicGuest {
  key?: string;
  character: string;
  displayName?: string;
  pos?: [number, number];
  pets?: Companion[];
  secrets?: number;
}
export interface Attendees {
  totalComing: number;
  guests: PublicGuest[];
}
export interface RsvpPayload {
  id: string;
  token: string;
  name: string;
  status: "yes" | "no";
  partySize: number;
  character: string | null;
  publicName: string | null;
  companions: Companion[];
  pos: [number, number] | null;
  secrets: number;
}
export interface RsvpResult {
  ok: true;
  attendees: Attendees;
  /** Index of this device's own character in attendees.guests, if it has one. */
  you: number | null;
}

export class ApiError extends Error {
  constructor(
    public code: "network" | "invalid_token" | "rate_limited" | "invalid" | "server",
    message: string,
  ) {
    super(message);
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "content-type": "application/json", accept: "application/json" } });
  } catch {
    throw new ApiError("network", "Network problem");
  } finally {
    window.clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || body === null || typeof body !== "object") {
    const code = (body as { error?: string } | null)?.error;
    if (res.status === 403 && code === "invalid_token") throw new ApiError("invalid_token", "Edit token rejected");
    if (res.status === 429) throw new ApiError("rate_limited", "Too many attempts");
    if (res.status === 400 || res.status === 422) throw new ApiError("invalid", code ?? "Invalid response");
    throw new ApiError("server", `Server error ${res.status}`);
  }
  return body;
}

function isAttendees(v: unknown): v is Attendees {
  const a = v as Attendees;
  return !!a && typeof a.totalComing === "number" && Array.isArray(a.guests);
}

export async function saveRsvp(payload: RsvpPayload): Promise<RsvpResult> {
  const body = (await request("/api/rsvp", { method: "POST", body: JSON.stringify(payload) })) as RsvpResult;
  if (body.ok !== true || !isAttendees(body.attendees)) throw new ApiError("server", "Unexpected reply");
  return { ok: true, attendees: body.attendees, you: typeof body.you === "number" ? body.you : null };
}

export async function fetchAttendees(): Promise<Attendees> {
  const body = await request("/api/attendees");
  if (!isAttendees(body)) throw new ApiError("server", "Unexpected reply");
  return body;
}
