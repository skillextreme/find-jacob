/**
 * App flow: loading -> searching -> revealing -> invite.
 * Discovery reactions are independent of RSVP state, and a replay resets only the game.
 */
import { jacobPortrait } from "./art.ts";
import { fetchAttendees, type Attendees } from "./api.ts";
import { Invite } from "./invite.ts";
import type { Park } from "./park.ts";
import type { Search } from "./search.ts";
import { hasFound, markFound } from "./storage.ts";

type State = "loading" | "searching" | "revealing" | "invite";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $("app");
const stage = $("stage");
const finder = $("finder");
const instruction = $("instruction");
const loading = $("loading");
const bubble = $<HTMLButtonElement>("jacob-bubble");
const skip = $<HTMLButtonElement>("skip");
const replay = $<HTMLButtonElement>("replay");
const countBadge = $("count-badge");
const inviteRoot = $("invite");
const live = $("live");

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const sidePanelQuery = window.matchMedia("(min-width: 880px) and (orientation: landscape)");
const reducedMotion = () => reducedMotionQuery.matches;

let park: Park | null = null;
let search: Search | null = null;
let invite: Invite | null = null;
let attendees: Attendees | null = null;
let you: number | null = null;
let inputKind: "touch" | "pointer" | "keyboard" = window.matchMedia("(pointer: coarse)").matches ? "touch" : "pointer";
let instructionOverride: string | null = null;

function setState(s: State): void {
  app.dataset.state = s;
  document.documentElement.classList.toggle("is-searching", s === "searching" || s === "revealing" || s === "loading");
}

let announceFlip = false;
function announce(message: string): void {
  // Alternate a trailing space so repeating the same message is still announced.
  announceFlip = !announceFlip;
  live.textContent = message + (announceFlip ? "" : " ");
}

function renderInstruction(): void {
  const base =
    inputKind === "touch" ? "Hold and drag to find me" : inputKind === "keyboard" ? "Use the arrow keys to find me" : "Move around to find me";
  instruction.textContent = instructionOverride ?? base;
}

function layout(): void {
  if (!park) return;
  park.layout(stage.clientWidth, window.innerHeight);
  search?.relayout();
}

function ensureInvite(): Invite {
  if (!invite) {
    invite = new Invite(inviteRoot, {
      announce,
      reducedMotion,
      onAttendees: (a, me, arriveSelf) => {
        attendees = a;
        you = me;
        showAttendees(arriveSelf ? "self" : "none");
      },
      showPark: () => {
        if (!sidePanelQuery.matches) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
      },
    });
  }
  return invite;
}

/** Guest characters only ever appear after the reveal, so they can't hide Jacob during the game. */
function showAttendees(arrive: "all" | "self" | "none"): void {
  if (app.dataset.state !== "invite") return;
  const total = attendees?.totalComing ?? 0;
  countBadge.hidden = total <= 0;
  countBadge.textContent = total === 1 ? "1 coming" : `${total} coming`;
  invite?.setCount(attendees ? total : null);
  if (!park) return;
  park.setGuests(attendees?.guests ?? [], you, arrive === "all" ? "all" : arrive === "self" ? you : null);
}

async function loadAttendees(): Promise<void> {
  try {
    attendees = await fetchAttendees();
    showAttendees("all");
  } catch {
    // The park and the RSVP keep working without the shared gathering.
  }
}

const SEARCH_LABEL = finder.getAttribute("aria-label") ?? "";

/** The scene is a keyboard-operated control while hidden and a plain picture once revealed. */
function setFinderRole(searching: boolean): void {
  if (searching) {
    finder.setAttribute("tabindex", "0");
    finder.setAttribute("role", "application");
    finder.setAttribute("aria-label", SEARCH_LABEL);
    finder.setAttribute("aria-describedby", "instruction");
  } else {
    finder.removeAttribute("tabindex");
    finder.setAttribute("role", "img");
    finder.setAttribute("aria-label", "The whole park in the sun. Jacob is waving beside a picnic blanket.");
    finder.removeAttribute("aria-describedby");
  }
}

function enterInvite(animated: boolean): void {
  app.classList.toggle("instant", !animated);
  setFinderRole(false);
  setState("invite");
  markFound();
  park?.setCover("gone");
  if (park) park.lens.style.display = "none";
  skip.hidden = true;
  bubble.hidden = true;
  replay.hidden = park === null;
  const card = ensureInvite();
  inviteRoot.hidden = false;
  inviteRoot.classList.toggle("unfold", animated && !reducedMotion());
  inviteRoot.classList.toggle("fade-in", animated && reducedMotion());
  if (animated) {
    announce("You found Jacob! The invitation is open.");
    // Focus moves to the invitation once the blanket has unfolded.
    window.setTimeout(() => card.focusHeading(), reducedMotion() ? 60 : 420);
  }
  window.setTimeout(() => park?.refreshMatrix(), 700);
  showAttendees("all");
  void loadAttendees();
}

function startSearch(): void {
  if (!park || !search) return;
  invite?.homeDecline();
  inviteRoot.hidden = true;
  replay.hidden = true;
  countBadge.hidden = true;
  skip.hidden = false;
  instructionOverride = null;
  renderInstruction();
  setFinderRole(true);
  setState("searching");
  window.scrollTo(0, 0);
  park.setGuests([], null, null);
  layout();
  search.start();
}

async function boot(): Promise<void> {
  $("portrait").innerHTML = jacobPortrait();
  renderInstruction();
  try {
    const [{ Park }, { Search }] = await Promise.all([import("./park.ts"), import("./search.ts")]);
    park = new Park(finder);
    search = new Search(park, stage, finder, bubble, {
      announce,
      reducedMotion,
      setInstruction: (text) => {
        instructionOverride = text;
        renderInstruction();
      },
      onInputKind: (kind) => {
        if (kind === inputKind) return;
        inputKind = kind;
        renderInstruction();
      },
      onRevealStart: () => setState("revealing"),
      onRevealed: () => enterInvite(true),
    });
    layout();
    // Give the web font a moment, but never hold the game up for it.
    await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => window.setTimeout(r, 1200))]);
  } catch {
    artworkFailed();
    return;
  }
  loading.hidden = true;
  if (hasFound()) enterInvite(false);
  else startSearch();
}

/** Artwork didn't load: offer a retry and show the readable invitation straight away. */
function artworkFailed(): void {
  park = null;
  search = null;
  loading.hidden = false;
  loading.innerHTML = "";
  const msg = document.createElement("span");
  msg.textContent = "The park drawing didn’t load. The invitation is below. ";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn btn--small";
  retry.textContent = "Try the game again";
  retry.addEventListener("click", () => window.location.reload());
  loading.append(msg, retry);
  instruction.hidden = true;
  app.classList.add("no-art");
  setState("invite");
  skip.hidden = true;
  ensureInvite();
  inviteRoot.hidden = false;
  void loadAttendees();
}

skip.addEventListener("click", () => search?.reveal());
replay.addEventListener("click", () => {
  startSearch();
  finder.focus({ preventScroll: true });
  announce("The park is hidden again. Your RSVP is unchanged.");
});

let resizeQueued = false;
function onResize(): void {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    layout();
    if (app.dataset.state === "invite") showAttendees("none");
  });
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
window.addEventListener("scroll", () => park?.refreshMatrix(), { passive: true });

void boot();
