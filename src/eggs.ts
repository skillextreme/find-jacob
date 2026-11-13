/**
 * Hidden extras in the revealed park. Each one is a tap on something in the scene.
 * They only work after the reveal, never during the search.
 */
import type { Park } from "./park.ts";

const KEY = "fj.eggs.v1";
const TOTAL = 7;

interface Hooks {
  isRevealed(): boolean;
  reducedMotion(): boolean;
  announce(message: string): void;
  chip: HTMLElement;
}

function loadFound(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function initEggs(park: Park, hooks: Hooks): { refresh(): void } {
  const found = loadFound();
  const svg = park.svg;

  const refresh = () => {
    hooks.chip.hidden = !hooks.isRevealed() || found.size === 0;
    hooks.chip.textContent = found.size >= TOTAL ? `All ${TOTAL} secrets found!` : `Secrets found: ${found.size} of ${TOTAL}`;
  };

  const mark = (id: string, message: string) => {
    hooks.announce(message);
    if (found.has(id)) return;
    found.add(id);
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...found]));
    } catch {
      /* fine without storage */
    }
    refresh();
  };

  /** Replays a one-shot CSS animation class. */
  const play = (el: Element, cls: string, ms: number) => {
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  };

  const topOf = (el: Element) => {
    const b = el.getBoundingClientRect();
    return park.toScene(b.left + b.width / 2, b.top);
  };

  svg.addEventListener("click", (e) => {
    if (!hooks.isRevealed()) return;
    const t = e.target as Element;
    const hit = (sel: string) => t.closest(sel);
    park.refreshMatrix();
    let el: Element | null;

    if ((el = hit("#sun"))) {
      // A bonus that isn't counted: on phones the sky is out of view beside the invitation.
      svg.classList.toggle("sun-cool");
      hooks.announce("The sun put on sunglasses.");
    } else if ((el = hit(".flutter"))) {
      play(el, "loop", 800);
      mark("butterfly", "The butterfly does a loop.");
    } else if ((el = hit("#it-jacob"))) {
      const p = topOf(el);
      if (hooks.reducedMotion()) park.pop(p.x, p.y - 10, "Yay, you came!");
      else park.confetti(p.x, p.y + 40);
      mark("jacob", "Confetti! Jacob is glad you came.");
    } else if ((el = hit("#it-duck"))) {
      const p = topOf(el);
      park.pop(p.x, p.y - 6, "Quack!");
      play(el, "react", 1900);
      mark("duck", "Quack! The duck waddles off.");
    } else if ((el = hit("#it-dog"))) {
      const p = topOf(el);
      park.pop(p.x, p.y - 6, "Woof!");
      play(el, "spin", 900);
      mark("dog", "Woof! The dog does a spin.");
    } else if ((el = hit(".balloon"))) {
      play(el, "away", 4200);
      mark("balloon", "A balloon floats away, then drifts back.");
    } else if ((el = hit("#it-bush2"))) {
      play(el, "peek", 2600);
      const p = topOf(el);
      park.pop(p.x, p.y - 30, "Psst!");
      mark("gnome", "A garden gnome peeks out of the bush.");
    } else if ((el = hit("#it-pond"))) {
      play(el, "splash", 1500);
      mark("fish", "A fish jumps out of the pond.");
    }
  });

  refresh();
  return { refresh };
}
