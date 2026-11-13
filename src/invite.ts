/**
 * The invitation card: event details, RSVP, calendar actions and the optional
 * "join the park" character picker. All event text comes from the config and all
 * guest-entered text is written with textContent, never as markup.
 */
import { EVENT, LIMITS, LOOK_PARTS, formatEventDate, formatEventTime, parseLook, parsePet, randomLook, randomPet, type Companion } from "./event.config.ts";
import { ApiError, saveRsvp, type Attendees, type RsvpPayload } from "./api.ts";
import { BOTTOMS, HAIR_COLORS, HAIR_STYLES, PET_COLORS, PET_KINDS, SKINS, TOPS, guestIcon, petIcon } from "./art.ts";
import { googleCalendarUrl, icsHref } from "./calendar.ts";
import { clearRsvp, loadEggs, loadRsvp, newIdentity, storeRsvp, type LocalRsvp } from "./storage.ts";

export interface InviteHooks {
  announce(message: string): void;
  reducedMotion(): boolean;
  /** Fresh public attendee data. `arriveSelf` is true when this device's character just joined. */
  onAttendees(attendees: Attendees, you: number | null, arriveSelf: boolean): void;
  /** Bring the park into view (on phones the card sits below it). */
  showPark(): void;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.nameMax);
}

function firstName(name: string): string {
  return (name.split(" ")[0] ?? "").slice(0, LIMITS.publicNameMax);
}

export class Invite {
  private $: <T extends HTMLElement>(sel: string) => T;
  private saving = false;
  private noBtn!: HTMLButtonElement;
  private fleeing = false;
  private fledFrom: { x: number; y: number; at: number } | null = null;
  private taunt = 0;
  private lastPointer: { type: string; at: number } | null = null;
  private pending: { payload: RsvpPayload; record: LocalRsvp; kind: "rsvp" | "join" | "pos" } | null = null;
  private draftLook: number[] = [1, 2, 0, 1, 0];
  private draftPets: Companion[] = [];

  constructor(
    private root: HTMLElement,
    private hooks: InviteHooks,
  ) {
    this.$ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    root.innerHTML = this.template();
    this.wire();
    this.showInitialView();
  }

  focusHeading(): void {
    this.$("#invite-title").focus({ preventScroll: false });
  }

  /** Headcount and first names of everyone who said yes, as plain readable text. */
  setCount(total: number | null, names: string[] = []): void {
    const el = this.$("#rsvp-count");
    if (total === null || total <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const count = total === 1 ? "1 person is coming so far" : `${total} people are coming so far`;
    el.textContent = names.length ? `${count}: ${names.join(", ")}.` : `${count}.`;
  }

  /* ---------- Markup ---------- */

  private template(): string {
    const row = (label: string, body: string) => `<div class="details__row"><dt>${esc(label)}</dt><dd>${body}</dd></div>`;
    const map = EVENT.mapUrl
      ? `<a class="btn btn--small" id="map-link" href="${esc(EVENT.mapUrl)}" target="_blank" rel="noopener">Open map</a>`
      : "";
    const sizes = Array.from({ length: EVENT.maxPartySize }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
    return `
<div class="card">
  <div class="card__trim" aria-hidden="true"></div>
  <div class="card__body">
    <h2 id="invite-title" tabindex="-1">You found me! Now come hang out.</h2>
    <p class="lead">It’s my birthday. Let’s spend an afternoon in the park.</p>
    <p class="event-name">${esc(EVENT.title)}</p>
    <dl class="details">
      ${row("When", `<strong>${esc(formatEventDate())}</strong><br />${esc(formatEventTime())} <span class="muted">(${esc(EVENT.timeZoneLabel)})</span>`)}
      ${row("Where", `<strong>${esc(EVENT.venue)}</strong><br />${esc(EVENT.meetingPoint)} ${map}`)}
      ${row("The plan", esc(EVENT.plan))}
      ${row("What to wear", esc(EVENT.bring))}
      ${EVENT.rainPlan ? row("If it rains", esc(EVENT.rainPlan)) : ""}
      ${EVENT.rsvpDeadline ? row("Reply by", esc(EVENT.rsvpDeadline)) : ""}
      ${EVENT.plusOnesAllowed ? row("Plus-ones", "Welcome. Bring whoever you like, just tell me how many.") : ""}
    </dl>

    <section class="rsvp" aria-labelledby="rsvp-h">
      <p id="rsvp-count" class="rsvp__who" hidden></p>
      <div id="leaders" class="leaders">
        <p class="leaders__title">Secret finders <span class="muted">There are ${LIMITS.secretsTotal} hidden in the park. Tap around.</span></p>
        <ol id="leaders-list"></ol>
        <p id="leaders-empty" class="leaders__empty">No one’s on the board yet. Find one and say yes to be first.</p>
      </div>
      <form id="rsvp-form" novalidate>
        <h3 id="rsvp-h">Are you coming?</h3>
        <div class="field">
          <label for="rsvp-name">Your name</label>
          <input id="rsvp-name" name="name" type="text" maxlength="${LIMITS.nameMax}" autocomplete="name" autocapitalize="words" enterkeyhint="done" aria-describedby="rsvp-name-err" />
          <p id="rsvp-name-err" class="field__err" hidden>Add your name so I know who’s coming.</p>
        </div>
        <div class="field" ${EVENT.plusOnesAllowed ? "" : "hidden"}>
          <label for="rsvp-size">How many of you? <span class="muted">Including you.</span></label>
          <select id="rsvp-size" name="partySize">${sizes}</select>
        </div>
        <div id="rsvp-companions" class="field" hidden></div>
        <p id="rsvp-comp-err" class="field__err" hidden>Add a name for everyone you’re bringing. They each get a pet in the park.</p>
        <div class="rsvp__actions" id="rsvp-actions">
          <button type="button" id="rsvp-yes" class="btn btn--primary">I’m coming</button>
          <button type="button" id="rsvp-no" class="btn btn--ghost">Can’t make it</button>
          <p id="dodge-msg" class="rsvp__dodge" aria-live="polite"></p>
        </div>
        <p class="muted small rsvp__public">Saying yes adds a character with your first name to the park, where everyone invited can see who’s coming. Anyone you bring shows up beside you as a named pet.</p>
        <p id="rsvp-saving" class="muted" role="status" hidden>Saving…</p>
        <div id="rsvp-error" class="notice notice--error" role="alert" hidden>
          <p id="rsvp-error-text"></p>
          <button type="button" id="rsvp-retry" class="btn btn--small">Try again</button>
          <button type="button" id="rsvp-fresh" class="btn btn--small" hidden>Send as a new response</button>
        </div>
      </form>

      <div id="view-yes" hidden>
        <h3 id="yes-h" tabindex="-1">See you at the picnic</h3>
        <p id="yes-sum" class="muted"></p>
        <div class="cal">
          <a id="cal-google" class="btn btn--primary" href="${esc(googleCalendarUrl())}" target="_blank" rel="noopener">Add to Google Calendar</a>
          <a id="cal-ics" class="btn btn--ghost" href="${esc(icsHref())}" type="text/calendar">Download calendar file</a>
        </div>
        <p class="muted small">If plans change, I’ll tell you on WhatsApp. A saved calendar entry won’t update by itself.</p>

        <fieldset class="join" id="join">
          <legend>You’re in the park</legend>
          <p class="small">Your character is at the picnic with your first name (<b id="join-first"></b>), where everyone invited can see it. <strong>Drag it in the park</strong> to stand wherever you like.</p>
          <div class="look">
            <div class="look__preview" id="look-preview"></div>
            <div class="look__opts" id="look-opts"></div>
          </div>
          <div id="pets" class="pets"></div>
          <div class="join__actions">
            <button type="button" id="look-save" class="btn btn--primary" disabled>Save my look</button>
            <button type="button" id="look-shuffle" class="btn btn--small">Shuffle</button>
          </div>
          <p id="join-status" class="muted small" role="status"></p>
          <div id="join-error" class="notice notice--error" role="alert" hidden>
            <p id="join-error-text"></p>
            <button type="button" id="join-retry" class="btn btn--small">Try again</button>
          </div>
        </fieldset>
        <button type="button" id="change-yes" class="btn btn--link">Change my response</button>
      </div>

      <div id="view-no" hidden>
        <h3 id="no-h" tabindex="-1">You’ll be missed. Thanks for letting me know.</h3>
        <button type="button" id="change-no" class="btn btn--link">Change my response</button>
      </div>
    </section>
  </div>
</div>`;
  }

  /* ---------- Behaviour ---------- */

  private wire(): void {
    const form = this.$<HTMLFormElement>("#rsvp-form");
    const nameInput = this.$<HTMLInputElement>("#rsvp-name");
    const noBtn = this.$<HTMLButtonElement>("#rsvp-no");

    form.addEventListener("submit", (e) => e.preventDefault());
    nameInput.addEventListener("input", () => this.setNameError(false));
    this.$("#rsvp-yes").addEventListener("click", () => this.submit("yes"));

    // The decline joke: the button can't be caught. It runs to a new spot on the screen whenever a
    // pointer or finger comes near, and a pointer or touch click never submits anything.
    // Keyboard activation (Tab, then Enter) still declines, so there is one honest way to say no.
    this.noBtn = noBtn;
    noBtn.addEventListener("pointerdown", (e) => {
      this.lastPointer = { type: e.pointerType, at: performance.now() };
      e.preventDefault();
      this.flee(e.clientX, e.clientY);
    });
    noBtn.addEventListener("pointerenter", (e) => this.flee(e.clientX, e.clientY));
    noBtn.addEventListener("click", (e) => {
      const p = this.lastPointer;
      this.lastPointer = null;
      const byPointer = e.detail > 0 || (p !== null && performance.now() - p.at < 1500);
      if (byPointer) {
        this.flee(e.clientX, e.clientY);
        return;
      }
      void this.submit("no");
    });
    const near = (e: PointerEvent) => {
      if (this.saving || this.root.hidden || this.$("#rsvp-form").hidden) return;
      const r = noBtn.getBoundingClientRect();
      if (r.width === 0) return;
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      if (Math.hypot(dx, dy) < 70) this.flee(e.clientX, e.clientY);
    };
    document.addEventListener("pointermove", near, { passive: true });
    document.addEventListener("pointerdown", near, { passive: true });
    window.addEventListener("resize", () => {
      if (this.fleeing) this.flee(-999, -999);
    });

    this.$("#rsvp-retry").addEventListener("click", () => void this.send());
    this.$("#rsvp-fresh").addEventListener("click", () => {
      if (!this.pending) return;
      const fresh = newIdentity();
      this.pending.payload = { ...this.pending.payload, ...fresh };
      this.pending.record = { ...this.pending.record, ...fresh, saved: false };
      clearRsvp();
      storeRsvp(this.pending.record);
      void this.send();
    });

    this.$("#change-yes").addEventListener("click", () => this.showForm(true));
    this.$("#change-no").addEventListener("click", () => this.showForm(true));

    // Plus-ones: one name field per extra person.
    this.$("#rsvp-size").addEventListener("change", () => this.renderCompanionFields());
    this.$("#rsvp-companions").addEventListener("input", () => {
      this.$("#rsvp-comp-err").hidden = true;
    });

    // Look and pet customiser. Nothing is sent until "Save my look".
    this.$("#join").addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button[data-part], button[data-pet]");
      if (!b || this.saving) return;
      if (b.dataset.part !== undefined) {
        this.draftLook[Number(b.dataset.part)] = Number(b.dataset.val);
      } else {
        const pet = this.draftPets[Number(b.dataset.pet)];
        const nums = parsePet(pet.pet) ?? [0, 0];
        nums[Number(b.dataset.slot)] = Number(b.dataset.val);
        pet.pet = nums.join(".");
      }
      this.renderLook(true);
    });
    this.$("#look-shuffle").addEventListener("click", () => {
      this.draftLook = parseLook(randomLook())!;
      for (const pet of this.draftPets) pet.pet = randomPet();
      this.renderLook(true);
    });
    this.$("#look-save").addEventListener("click", () => void this.saveLook());
    this.$("#join-retry").addEventListener("click", () => void this.send());
  }

  /** Jumps the decline button to a random spot on the screen, well away from the pointer. */
  private flee(px: number, py: number): void {
    const btn = this.noBtn;
    if (this.saving) return;
    const r = btn.getBoundingClientRect();
    const w = r.width || 150;
    const h = r.height || 48;
    if (!this.fleeing) {
      // Leave the card (which clips its contents) and live on the screen itself.
      this.fleeing = true;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${w}px`;
      btn.classList.add("runaway");
      document.body.appendChild(btn);
      void btn.offsetWidth; // start the first move from where it was
    }
    const now = performance.now();
    const recent = this.fledFrom && now - this.fledFrom.at < 600 ? this.fledFrom : null;
    if (!recent) this.fledFrom = { x: r.left, y: r.top, at: now };
    const pad = 10;
    const maxX = Math.max(pad, window.innerWidth - w - pad);
    const maxY = Math.max(pad, window.innerHeight - h - pad);
    let x = pad, y = pad, best = -1;
    for (let i = 0; i < 24; i++) {
      const cx = pad + Math.random() * (maxX - pad);
      const cy = pad + Math.random() * (maxY - pad);
      // Far from the pointer and far from where it is now, so every escape is a real jump.
      const d = Math.min(
        Math.hypot(cx + w / 2 - px, cy + h / 2 - py),
        Math.hypot(cx - r.left, cy - r.top) * 1.5,
        // One tap can set off two jumps in a row; the second must not land back where the first began.
        recent ? Math.hypot(cx - recent.x, cy - recent.y) * 1.5 : Infinity,
      );
      // Never land on top of the Yes button or the name field.
      const blocked = ["#rsvp-yes", "#rsvp-name"].some((sel) => {
        const o = this.$(sel).getBoundingClientRect();
        return cx < o.right + 8 && cx + w > o.left - 8 && cy < o.bottom + 8 && cy + h > o.top - 8;
      });
      if (blocked) continue;
      if (d > best) {
        best = d;
        x = cx;
        y = cy;
      }
      if (d > 260) break;
    }
    btn.style.left = `${x.toFixed(0)}px`;
    btn.style.top = `${y.toFixed(0)}px`;
    const lines = ["Nice try.", "Not that one.", "Nope, still no.", "You’re coming. Tap the other one.", "It’s faster than you."];
    this.$("#dodge-msg").textContent = lines[this.taunt++ % lines.length];
  }

  /** Puts the decline button back in the form (or hides it when the form isn't showing). */
  homeDecline(): void {
    if (!this.fleeing) return;
    this.fleeing = false;
    const btn = this.noBtn;
    btn.classList.remove("runaway");
    btn.style.left = btn.style.top = btn.style.width = "";
    this.$("#rsvp-actions").insertBefore(btn, this.$("#dodge-msg"));
    this.$("#dodge-msg").textContent = "";
  }

  private showInitialView(): void {
    const rec = loadRsvp();
    if (rec?.saved) this.showSaved(rec, false);
    else this.showForm(false, rec);
  }

  private showForm(focus: boolean, rec: LocalRsvp | null = loadRsvp()): void {
    this.homeDecline();
    this.$("#rsvp-form").hidden = false;
    this.$("#view-yes").hidden = true;
    this.$("#view-no").hidden = true;
    this.setError(null);
    if (rec) {
      this.$<HTMLInputElement>("#rsvp-name").value = rec.name;
      this.$<HTMLSelectElement>("#rsvp-size").value = String(rec.partySize);
    }
    this.renderCompanionFields(rec?.companions ?? []);
    if (focus) this.$<HTMLInputElement>("#rsvp-name").focus();
  }

  private showSaved(rec: LocalRsvp, focus: boolean): void {
    this.homeDecline();
    this.$("#rsvp-form").hidden = true;
    const yes = rec.status === "yes";
    this.$("#view-yes").hidden = !yes;
    this.$("#view-no").hidden = yes;
    if (yes) {
      const others = rec.companions.map((c) => c.name);
      const withText = others.length ? `, with ${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}` : others[0]}` : "";
      this.$("#yes-sum").textContent = `You’re down as ${rec.name}${withText}.`;
      this.$("#join-first").textContent = firstName(rec.name);
      this.draftLook = parseLook(rec.character) ?? parseLook(randomLook())!;
      this.draftPets = rec.companions.map((c) => ({ ...c }));
      this.$("#join-status").textContent = "";
      this.renderLook(false);
      this.setJoinError(null);
    }
    if (focus) this.$(yes ? "#yes-h" : "#no-h").focus();
  }

  /** Draws one name field for each extra person, keeping anything already typed. */
  private renderCompanionFields(saved: Companion[] = []): void {
    const box = this.$("#rsvp-companions");
    const typed = Array.from(box.querySelectorAll<HTMLInputElement>("input"), (i) => i.value);
    const extra = Math.max(0, Number(this.$<HTMLSelectElement>("#rsvp-size").value) - 1);
    box.hidden = extra === 0;
    box.replaceChildren();
    if (extra === 0) return;
    const title = document.createElement("p");
    title.className = "field__title";
    title.textContent = extra === 1 ? "Who’s coming with you?" : "Who’s coming with you? They each join the park as a pet.";
    box.append(title);
    for (let i = 0; i < extra; i++) {
      const input = document.createElement("input");
      input.type = "text";
      input.id = `rsvp-comp-${i}`;
      input.maxLength = LIMITS.companionNameMax;
      input.autocapitalize = "words";
      input.placeholder = `Name of guest ${i + 2}`;
      input.setAttribute("aria-label", `Name of guest ${i + 2}`);
      input.value = typed[i] ?? saved[i]?.name ?? "";
      box.append(input);
    }
  }

  /** Redraws the customiser from the draft look. */
  private renderLook(dirty: boolean): void {
    const code = this.draftLook.join(".");
    this.$("#look-preview").innerHTML = guestIcon(code);
    const swatches = (part: number, colours: string[], label: string) =>
      colours
        .map(
          (c, v) =>
            `<button type="button" class="sw" style="--c:${c}" data-part="${part}" data-val="${v}" aria-pressed="${this.draftLook[part] === v}" aria-label="${label} ${v + 1}"></button>`,
        )
        .join("");
    const chips = HAIR_STYLES.slice(0, LOOK_PARTS[1])
      .map((h, v) => `<button type="button" class="chipbtn" data-part="1" data-val="${v}" aria-pressed="${this.draftLook[1] === v}">${esc(h.label)}</button>`)
      .join("");
    const row = (label: string, body: string) => `<div class="look__row"><span class="look__label">${label}</span><div class="look__set">${body}</div></div>`;
    this.$("#look-opts").innerHTML =
      row("Skin", swatches(0, SKINS, "Skin")) +
      row("Hair", chips) +
      row("Hair colour", swatches(2, HAIR_COLORS, "Hair colour")) +
      row("Top", swatches(3, TOPS, "Top")) +
      row("Bottoms", swatches(4, BOTTOMS, "Bottoms"));

    const pets = this.$("#pets");
    pets.replaceChildren();
    this.draftPets.forEach((pet, i) => {
      const [kind, colour] = parsePet(pet.pet) ?? [0, 0];
      const el = document.createElement("div");
      el.className = "petrow";
      el.innerHTML =
        `<div class="pet__art">${petIcon(pet.pet)}</div><div class="pet__body"><p class="pet__name"></p>` +
        `<div class="look__set">${PET_KINDS.map((k, v) => `<button type="button" class="chipbtn" data-pet="${i}" data-slot="0" data-val="${v}" aria-pressed="${kind === v}">${k}</button>`).join("")}</div>` +
        `<div class="look__set">${PET_COLORS.map((c, v) => `<button type="button" class="sw" style="--c:${c}" data-pet="${i}" data-slot="1" data-val="${v}" aria-pressed="${colour === v}" aria-label="Pet colour ${v + 1}"></button>`).join("")}</div></div>`;
      el.querySelector(".pet__name")!.textContent = `${pet.name}, your plus-one`;
      pets.append(el);
    });

    this.$<HTMLButtonElement>("#look-save").disabled = !dirty;
    if (dirty) this.$("#join-status").textContent = "Not saved yet.";
  }

  private async saveLook(): Promise<void> {
    if (this.saving) return;
    const rec = loadRsvp();
    if (!rec?.saved || rec.status !== "yes") return;
    const record: LocalRsvp = { ...rec, character: this.draftLook.join("."), companions: this.draftPets.map((p) => ({ ...p })) };
    this.pending = { kind: "join", record, payload: this.toPayload(record) };
    await this.send();
  }

  /** Called when the guest drops their character somewhere new in the park. */
  /** Sends the latest secrets count for the leaderboard. Only guests who said yes are on it. */
  async saveSecrets(): Promise<void> {
    const rec = loadRsvp();
    if (!rec?.saved || rec.status !== "yes") return;
    if (this.saving) {
      // Something else is saving; try again shortly so the count isn't lost.
      window.setTimeout(() => void this.saveSecrets(), 1500);
      return;
    }
    this.pending = { kind: "pos", record: rec, payload: this.toPayload(rec) };
    await this.send(true);
  }

  /** Top secret finders, as a tiny leaderboard. */
  setLeaders(rows: { name: string; secrets: number }[]): void {
    const box = this.$("#leaders");
    const top = rows.filter((r) => r.secrets > 0).sort((a, b) => b.secrets - a.secrets).slice(0, 5);
    box.hidden = false;
    this.$("#leaders-empty").hidden = top.length > 0;
    const list = this.$("#leaders-list");
    list.replaceChildren();
    for (const r of top) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = r.name; // plain text
      const score = document.createElement("b");
      score.textContent = r.secrets >= LIMITS.secretsTotal ? `all ${LIMITS.secretsTotal}!` : `${r.secrets} of ${LIMITS.secretsTotal}`;
      li.append(name, score);
      list.append(li);
    }
  }

  async savePosition(pos: [number, number]): Promise<void> {
    const rec = loadRsvp();
    if (this.saving || !rec?.saved || rec.status !== "yes") return;
    const record: LocalRsvp = { ...rec, pos };
    this.pending = { kind: "pos", record, payload: this.toPayload(record) };
    await this.send();
  }

  private setNameError(on: boolean): void {
    this.$("#rsvp-name-err").hidden = !on;
    this.$("#rsvp-name").setAttribute("aria-invalid", on ? "true" : "false");
  }

  private setSaving(on: boolean): void {
    this.saving = on;
    this.root.querySelector(".rsvp")!.setAttribute("aria-busy", on ? "true" : "false");
    for (const id of ["#rsvp-yes", "#rsvp-no", "#rsvp-retry", "#rsvp-fresh", "#join-retry", "#look-save", "#look-shuffle"]) {
      const b = id === "#rsvp-no" ? this.noBtn : this.$<HTMLButtonElement>(id);
      if (on) {
        b.dataset.wasDisabled = b.disabled ? "1" : "";
        b.disabled = true;
      } else if (b.dataset.wasDisabled !== undefined) {
        b.disabled = b.dataset.wasDisabled === "1";
        delete b.dataset.wasDisabled;
      }
    }
    this.$("#rsvp-saving").hidden = !on || this.pending?.kind !== "rsvp";
    if (on && this.pending?.kind === "join") this.$("#join-status").textContent = "Saving…";
  }

  private setError(err: ApiError | null): void {
    const box = this.$("#rsvp-error");
    box.hidden = err === null;
    if (!err) return;
    this.$("#rsvp-error-text").textContent = this.errorText(err);
    this.$("#rsvp-fresh").hidden = err.code !== "invalid_token";
    this.$("#rsvp-retry").hidden = err.code === "invalid_token";
  }

  private setJoinError(err: ApiError | null): void {
    this.$("#join-error").hidden = err === null;
    if (err) {
      this.$("#join-error-text").textContent = this.errorText(err);
      this.$("#join-status").textContent = "";
    }
  }

  private errorText(err: ApiError): string {
    switch (err.code) {
      case "invalid_token":
        return `This device’s saved response couldn’t be verified, so nothing was changed. ${EVENT.hostContact} to update it, or send this as a new response.`;
      case "rate_limited":
        return "Too many tries from this connection. Wait a few minutes, then try again. Your details are still here.";
      case "invalid":
        return "Something in that response wasn’t accepted. Check your name and try again.";
      default:
        return "That didn’t save. Your details are still here, so just try again.";
    }
  }

  /** Validates the form and sends a yes or no. */
  private async submit(status: "yes" | "no"): Promise<void> {
    if (this.saving) return;
    const name = cleanName(this.$<HTMLInputElement>("#rsvp-name").value);
    if (!name) {
      this.setNameError(true);
      this.$<HTMLInputElement>("#rsvp-name").focus();
      return;
    }
    const rawSize = Number(this.$<HTMLSelectElement>("#rsvp-size").value);
    const partySize = EVENT.plusOnesAllowed ? Math.min(EVENT.maxPartySize, Math.max(1, Math.round(rawSize) || 1)) : 1;

    const existing = loadRsvp();
    const identity = existing ?? { ...newIdentity(), character: null, companions: [], pos: null, showName: true, saved: false };

    // Everyone a guest brings must be named. Each one joins the park as a pet (random at first).
    let companions = identity.companions;
    if (status === "yes") {
      const fields = Array.from(this.$("#rsvp-companions").querySelectorAll<HTMLInputElement>("input")).slice(0, partySize - 1);
      const names = fields.map((f) => cleanName(f.value).slice(0, LIMITS.companionNameMax));
      const missing = names.findIndex((n) => !n);
      if (names.length !== partySize - 1 || missing !== -1) {
        this.$("#rsvp-comp-err").hidden = false;
        fields[Math.max(0, missing)]?.focus();
        return;
      }
      companions = names.map((n, i) => ({ name: n, pet: identity.companions[i]?.pet ?? randomPet() }));
    }

    // Saying yes always puts a character in the park. A first-timer gets a random one and can change it after.
    const character = identity.character ?? (status === "yes" ? randomLook() : null);
    const record: LocalRsvp = { ...identity, name, status, partySize, character, companions, showName: true, saved: false };
    // Keep the id and token before the first request, so a retry after a dropped connection
    // or a reload updates the same response instead of adding a second one.
    if (!existing) storeRsvp(record);
    this.pending = { kind: "rsvp", record, payload: this.toPayload(record) };
    await this.send();
  }

  private toPayload(r: LocalRsvp): RsvpPayload {
    return {
      id: r.id,
      token: r.token,
      name: r.name,
      status: r.status,
      partySize: r.partySize,
      character: r.character,
      publicName: r.status === "yes" && r.character ? firstName(r.name) || null : null,
      companions: r.status === "yes" ? r.companions.slice(0, Math.max(0, r.partySize - 1)) : [],
      pos: r.pos,
      secrets: Math.min(LIMITS.secretsTotal, loadEggs().size),
    };
  }

  /** Sends the pending request. Retries reuse the same id and token, so they can't create a duplicate. */
  private async send(quiet = false): Promise<void> {
    const job = this.pending;
    if (!job || this.saving) return;
    this.setError(null);
    this.setJoinError(null);
    this.setSaving(true);
    try {
      const res = await saveRsvp(job.payload);
      const record: LocalRsvp = { ...job.record, saved: true };
      storeRsvp(record);
      this.pending = null;
      this.setSaving(false);
      if (job.kind !== "pos") this.showSaved(record, job.kind === "rsvp");
      this.hooks.onAttendees(res.attendees, res.you, job.kind === "rsvp" && record.status === "yes");
      if (quiet) {
        /* a background save: nothing to say */
      } else if (job.kind === "pos") {
        this.hooks.announce("Your character has moved.");
      } else if (job.kind === "rsvp") {
        this.hooks.announce(record.status === "yes" ? "Saved. See you at the picnic. Your character has joined the park." : "Saved. You’ll be missed. Thanks for letting me know.");
      } else {
        this.hooks.announce("Your look in the park has changed.");
        this.$("#join-status").textContent = "Saved. That’s you in the park now.";
        this.hooks.showPark();
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("server", "Unexpected error");
      this.setSaving(false);
      // A failed save never shows a confirmation and never adds a character.
      if (quiet) return;
      if (job.kind === "rsvp") this.setError(err);
      else this.setJoinError(err);
    }
  }
}
