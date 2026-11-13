/**
 * The quick search: a circular window follows the pointer, finger or arrow keys and
 * reveals a small part of the hidden park. All per-frame work writes SVG attributes
 * directly from one requestAnimationFrame loop.
 */
import type { Park, Pt } from "./park.ts";

/** Starting values from the brief. Tune these after testing with real guests. */
export const TUNING = {
  diameterDesktopPx: 180,
  diameterPhonePx: 140,
  pauseMs: 500,
  growBy: 0.15,
  growMs: 200,
  hintAtMs: 10_000,
  shoutAtMs: 20_000,
  revealMs: 800,
  discoveryCooldownMs: 2500,
  dragThresholdPx: 10,
};

/** Where the preview window sits before the guest has moved (normalized). */
const PREVIEW = { landscape: { x: 0.5, y: 0.39 }, portrait: { x: 0.42, y: 0.4 } };

interface Discovery {
  id: "dog" | "bush" | "duck";
  inside: boolean;
  readyAt: number;
  message: string;
}

export interface SearchHooks {
  announce(message: string): void;
  setInstruction(text: string): void;
  reducedMotion(): boolean;
  onInputKind(kind: "touch" | "pointer" | "keyboard"): void;
  onRevealStart(): void;
  onRevealed(): void;
}

export class Search {
  active = false;
  revealing = false;

  private nx = 0.5;
  private ny = 0.5;
  private baseR = 100;
  private grow = 0;
  private started = false;
  private activeMs = 0;
  private lastMove = 0;
  private lastFrame = 0;
  private raf = 0;
  private hint = false;
  private shout = false;
  private jacobIn = false;
  private jacobOutAt = 0;
  private dragId: number | null = null;
  private tapStart: { x: number; y: number } | null = null;
  private dog = { x: 0, y: 0, alert: false };
  private discoveries: Discovery[] = [
    { id: "dog", inside: false, readyAt: 0, message: "You spotted a dog. It looks up and trots after you." },
    { id: "bush", inside: false, readyAt: 0, message: "A bush rustles and a little bird pops out." },
    { id: "duck", inside: false, readyAt: 0, message: "A duck waddles off and leaves a few footprints." },
  ];

  constructor(
    private park: Park,
    private stage: HTMLElement,
    finder: HTMLElement,
    private bubble: HTMLButtonElement,
    private hooks: SearchHooks,
  ) {
    stage.addEventListener("pointermove", this.onPointerMove);
    stage.addEventListener("pointerdown", this.onPointerDown);
    stage.addEventListener("pointerup", this.onPointerUp);
    stage.addEventListener("pointercancel", this.onPointerCancel);
    finder.addEventListener("keydown", this.onKeyDown);
    bubble.addEventListener("click", () => this.found());
    document.addEventListener("visibilitychange", () => {
      // Timers only count visible time: restart the frame clock when the tab comes back.
      this.lastFrame = performance.now();
    });
  }

  /** Begins (or restarts) the search with the cover in place. Never touches the RSVP. */
  start(): void {
    this.active = true;
    this.revealing = false;
    this.started = false;
    this.activeMs = 0;
    this.hint = false;
    this.shout = false;
    this.jacobIn = false;
    this.grow = 0;
    this.dragId = null;
    this.tapStart = null;
    this.dog = { x: 0, y: 0, alert: false };
    for (const d of this.discoveries) {
      d.inside = false;
      d.readyAt = 0;
      this.park.el(d.id).classList.remove("react", "alert");
    }
    this.park.el("jacob").classList.remove("wave");
    this.park.plane.style.display = "none";
    this.park.lens.style.display = "";
    this.bubble.hidden = true;
    this.bubble.classList.remove("bubble--shout");
    const pv = PREVIEW[this.park.mode];
    this.nx = pv.x;
    this.ny = pv.y;
    this.park.setCover("covering");
    this.relayout();
    this.lastMove = this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Call after the park has been laid out again (resize, rotation). Keeps all progress. */
  relayout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const target = vw < 520 ? TUNING.diameterPhonePx : TUNING.diameterDesktopPx;
    const diameter = Math.max(110, Math.min(target, 0.42 * Math.min(vw, vh)));
    this.baseR = (diameter / 2) * this.park.unitsPerPx();
    if (!this.started) {
      const pv = PREVIEW[this.park.mode];
      this.nx = pv.x;
      this.ny = pv.y;
    }
    this.clamp();
    this.placeBubble();
    if (this.active) this.draw();
  }

  private get ox(): number {
    return this.nx * this.park.W;
  }
  private get oy(): number {
    return this.ny * this.park.H;
  }
  private get r(): number {
    return this.baseR * (1 + TUNING.growBy * this.grow);
  }

  private clamp(): void {
    const v = this.park.visible();
    this.nx = Math.min(v.x1, Math.max(v.x0, this.ox)) / this.park.W;
    this.ny = Math.min(v.y1, Math.max(v.y0, this.oy)) / this.park.H;
  }

  private moveTo(clientX: number, clientY: number): void {
    const p = this.park.toScene(clientX, clientY);
    this.nx = p.x / this.park.W;
    this.ny = p.y / this.park.H;
    this.clamp();
    this.touch();
  }

  /** Marks activity: resets the pause timer and starts the search clock. */
  private touch(): void {
    this.lastMove = performance.now();
    this.started = true;
  }

  private isControl(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest("button, a, input, select, label") !== null;
  }

  /* ---------- Pointer and touch ---------- */

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active) return;
    if (e.pointerType === "mouse") {
      this.hooks.onInputKind("pointer");
      this.moveTo(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== this.dragId) return;
    if (this.tapStart) {
      if (Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y) < TUNING.dragThresholdPx) return;
      this.tapStart = null;
    }
    this.moveTo(e.clientX, e.clientY - this.fingerOffsetPx());
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active || this.isControl(e.target)) return;
    if (e.pointerType === "mouse") return;
    this.hooks.onInputKind("touch");
    this.dragId = e.pointerId;
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    const p = this.park.toScene(e.clientX, e.clientY);
    const insideWindow = this.started && Math.hypot(p.x - this.ox, p.y - this.oy) <= this.r;
    if (insideWindow) {
      // A press on something already visible is a possible tap: keep the window still until it moves.
      this.tapStart = { x: e.clientX, y: e.clientY };
      this.touch();
    } else {
      this.tapStart = null;
      this.moveTo(e.clientX, e.clientY - this.fingerOffsetPx());
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.active || this.isControl(e.target)) return;
    if (e.pointerType === "mouse") {
      if (e.button === 0) this.tryHit(this.park.toScene(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== this.dragId) return;
    this.dragId = null;
    if (this.tapStart) {
      this.tapStart = null;
      this.tryHit(this.park.toScene(e.clientX, e.clientY));
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.dragId) {
      this.dragId = null;
      this.tapStart = null;
    }
  };

  /** The window sits just above the finger so the fingertip never hides it. */
  private fingerOffsetPx(): number {
    return this.r / this.park.unitsPerPx() + 12;
  }

  /* ---------- Keyboard ---------- */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    const step = this.baseR * (e.shiftKey ? 1.2 : 0.55);
    let dx = 0, dy = 0;
    switch (e.key) {
      case "ArrowLeft": dx = -step; break;
      case "ArrowRight": dx = step; break;
      case "ArrowUp": dy = -step; break;
      case "ArrowDown": dy = step; break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (this.jacobIn || this.shout) this.found();
        else this.hooks.announce(`Jacob isn't in view yet. ${this.directionHint()}`);
        return;
      default:
        return;
    }
    e.preventDefault();
    this.hooks.onInputKind("keyboard");
    this.nx = (this.ox + dx) / this.park.W;
    this.ny = (this.oy + dy) / this.park.H;
    this.clamp();
    this.touch();
  };

  private directionHint(): string {
    const j = this.park.center("jacob");
    const dx = j.x - this.ox, dy = j.y - this.oy;
    const parts: string[] = [];
    if (Math.abs(dy) > this.baseR * 0.5) parts.push(dy < 0 ? "up" : "down");
    if (Math.abs(dx) > this.baseR * 0.5) parts.push(dx < 0 ? "left" : "right");
    return parts.length ? `Try moving ${parts.join(" and ")}.` : "He is very close.";
  }

  /* ---------- Finding Jacob ---------- */

  private tryHit(p: Pt): void {
    const j = this.park.center("jacob");
    const hitR = 66 * this.park.scaleOf("jacob");
    const visible = Math.hypot(j.x - this.ox, j.y - this.oy) <= this.r;
    if (visible && Math.hypot(p.x - j.x, p.y - j.y) <= hitR) this.found();
  }

  /** Completes the search once. Further input cannot restart the reveal. */
  found(): void {
    if (!this.active || this.revealing) return;
    this.reveal();
  }

  /** Expands the window from where it is now until the whole park shows. */
  reveal(): void {
    if (!this.active || this.revealing) return;
    this.active = false;
    this.revealing = true;
    this.dragId = null;
    cancelAnimationFrame(this.raf);
    this.bubble.hidden = true;
    this.park.plane.style.display = "none";
    this.park.el("jacob").classList.add("wave");
    this.hooks.onRevealStart();

    const finish = () => {
      this.revealing = false;
      this.park.setCover("gone");
      this.park.lens.style.display = "none";
      this.hooks.onRevealed();
    };

    if (this.hooks.reducedMotion()) {
      this.park.setCover("hidden"); // short fade, no expanding motion
      window.setTimeout(finish, 220);
      return;
    }
    const { W, H } = this.park;
    const cx = this.ox, cy = this.oy, from = this.r;
    const to = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) + 30;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / TUNING.revealMs);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.park.setHole(cx, cy, from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  /* ---------- Frame loop ---------- */

  private frame = (now: number): void => {
    if (!this.active) return;
    const dt = Math.min(100, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    if (this.started && !document.hidden) this.activeMs += dt;

    // The size eases, the position never does.
    const wantGrow = now - this.lastMove > TUNING.pauseMs ? 1 : 0;
    const stepGrow = dt / TUNING.growMs;
    this.grow = wantGrow > this.grow ? Math.min(1, this.grow + stepGrow) : Math.max(0, this.grow - stepGrow * 1.6);

    this.draw();
    if (this.started) {
      this.checkDiscoveries(now, dt);
      this.checkJacob(now);
      this.checkClues();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    this.park.setHole(this.ox, this.oy, this.r);
    if (this.hint) this.drawPlane();
  }

  private checkDiscoveries(now: number, dt: number): void {
    for (const d of this.discoveries) {
      const c = this.park.center(d.id);
      const cx = d.id === "dog" ? c.x + this.dog.x : c.x;
      const cy = d.id === "dog" ? c.y + this.dog.y : c.y;
      const dist = Math.hypot(cx - this.ox, cy - this.oy);
      const el = this.park.el(d.id);
      if (!d.inside && dist < this.r * 0.75 && now >= d.readyAt) {
        // One reaction per pass.
        d.inside = true;
        d.readyAt = now + TUNING.discoveryCooldownMs;
        el.classList.remove("react");
        void el.getBoundingClientRect();
        el.classList.add("react");
        window.setTimeout(() => el.classList.remove("react"), 1900);
        if (d.id === "dog") {
          this.dog.alert = true;
          el.classList.add("alert");
        }
        this.hooks.announce(d.message);
      } else if (d.inside && dist > this.r * 1.25) {
        d.inside = false;
        if (d.id === "dog") {
          this.dog.alert = false;
          el.classList.remove("alert");
        }
      }
    }

    // The dog follows the window a short distance, then settles back home.
    const home = this.park.center("dog");
    let tx = 0, ty = 0;
    if (this.dog.alert && !this.hooks.reducedMotion()) {
      const dx = this.ox - home.x, dy = this.oy - home.y;
      const len = Math.hypot(dx, dy) || 1;
      const reach = Math.min(54, len * 0.6);
      tx = (dx / len) * reach;
      ty = (dy / len) * reach * 0.6;
    }
    const k = 1 - Math.exp(-dt / 220);
    this.dog.x += (tx - this.dog.x) * k;
    this.dog.y += (ty - this.dog.y) * k;
    const s = this.park.scaleOf("dog");
    const dogEl = this.park.el("dog");
    (dogEl.querySelector(".dog-move") as SVGGElement).setAttribute("transform", `translate(${(this.dog.x / s).toFixed(1)},${(this.dog.y / s).toFixed(1)})`);
    if (Math.abs(tx) > 6) (dogEl.querySelector(".dog-flip") as SVGGElement).setAttribute("transform", tx < 0 ? "scale(-1,1)" : "");
  }

  private checkJacob(now: number): void {
    const j = this.park.center("jacob");
    const inside = Math.hypot(j.x - this.ox, j.y - this.oy) < this.r * 0.8;
    const el = this.park.el("jacob");
    if (inside && !this.jacobIn) {
      this.jacobIn = true;
      el.classList.add("wave");
      if (!this.shout) {
        this.bubble.textContent = "Found me?";
        this.bubble.hidden = false;
      }
      this.hooks.announce("Is that Jacob waving? Press Enter, or tap him, to say you found him.");
    } else if (!inside && this.jacobIn) {
      this.jacobIn = false;
      this.jacobOutAt = now;
    }
    if (!this.jacobIn && !this.shout && !this.bubble.hidden && now - this.jacobOutAt > 900) {
      this.bubble.hidden = true;
      el.classList.remove("wave");
    }
  }

  private checkClues(): void {
    if (!this.hint && this.activeMs >= TUNING.hintAtMs) {
      this.hint = true;
      this.hooks.setInstruction("Hint: follow the paper plane");
      this.hooks.announce(`Hint: a paper plane is pointing toward Jacob. ${this.directionHint()}`);
    }
    if (!this.shout && this.activeMs >= TUNING.shoutAtMs) {
      this.shout = true;
      this.bubble.textContent = "Over here!";
      this.bubble.classList.add("bubble--shout");
      this.bubble.hidden = false;
      this.placeBubble();
      this.park.el("jacob").classList.add("wave");
      this.hooks.setInstruction("I'm over here! Tap my bubble.");
      this.hooks.announce("Jacob is calling: Over here! Press Enter, or select the Over here button, to finish.");
    }
  }

  private drawPlane(): void {
    const j = this.park.center("jacob");
    const dx = j.x - this.ox, dy = j.y - this.oy;
    const dist = Math.hypot(dx, dy);
    const plane = this.park.plane;
    if (this.jacobIn || dist < this.r * 0.9) {
      plane.style.display = "none";
      return;
    }
    plane.style.display = "";
    const reach = this.r * 0.56;
    const s = this.park.unitsPerPx() * 0.95;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    plane.setAttribute(
      "transform",
      `translate(${(this.ox + (dx / dist) * reach).toFixed(1)},${(this.oy + (dy / dist) * reach).toFixed(1)}) rotate(${angle.toFixed(1)}) scale(${s.toFixed(3)})`,
    );
  }

  /** Puts the HTML speech bubble next to Jacob's head. */
  placeBubble(): void {
    const j = this.park.center("jacob");
    const s = this.park.scaleOf("jacob");
    const head = this.park.toClient(j.x + 16 * s, j.y - 62 * s);
    const box = this.stage.getBoundingClientRect();
    const x = Math.min(box.width - 150, Math.max(8, head.x - box.left));
    const y = Math.max(52, head.y - box.top);
    this.bubble.style.left = `${x.toFixed(0)}px`;
    this.bubble.style.top = `${y.toFixed(0)}px`;
  }
}
