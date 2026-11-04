// The bottom sheet's engine: where the sheet is, where it is going, and what
// the finger is doing to it.
//
// Imperative on purpose. The old MobileSheet kept the drag offset in React
// state, so every touchmove re-rendered the sheet AND its contents (the whole
// Settings panel, a long Contents list) — the main reason dragging felt heavy.
// Here position lives in fields, `apply` writes transform/opacity straight to
// the DOM, and settles are handed to the compositor (see animate.ts). React
// only mounts and unmounts the sheet.
//
// Behaviour is the spec's: docs/superpowers/specs/2026-11-04-native-feel-
// sheets-design.md. Who owns a touch is gesture.ts; the numbers are
// physics.ts.

import { EASE_POINTS, isReducedMotion, MOTION } from "../../styles/motion";
import { type Playback, playTracks } from "./animate";
import {
  classifyTarget,
  decideOwner,
  findBody,
  isScrollableY,
  type Region,
  readTranslateY,
  type TargetKind,
} from "./gesture";
import {
  displayY,
  distribute,
  easeSamples,
  footerOffset,
  MOMENTUM_DECAY_PER_MS,
  type MoveSample,
  pickSnap,
  type SheetGeometry,
  SLOP_PX,
  type Snap,
  scrimOpacity,
  snapY,
  springSamples,
  topSnap,
  VELOCITY_WINDOW_MS,
  velocityFromSamples,
} from "./physics";

export interface SheetElements {
  /** The sheet itself: the element that is translated. */
  box: HTMLElement;
  scrim: HTMLElement;
  /** The container the sheet's children render into. */
  content: HTMLElement;
  /** The pinned-footer slot (may be empty). */
  footer: HTMLElement;
}

export interface SheetCallbacks {
  /** A gesture decided to close the sheet. The exit is already running. */
  onDismiss(): void;
  /** The exit animation reached the bottom; the sheet can unmount. */
  onExitFinished(): void;
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  /** performance.now() time base, ms. */
  t: number;
  target: Element;
  /** A mouse drag: accepted on chrome only. */
  mouse?: boolean;
}

const FRAME_MS = 1000 / 60;
/** How long after a drag a click is still treated as part of it. */
const CLICK_SUPPRESS_MS = 400;
/** Gap kept between a revealed element and the visible bottom. */
const REVEAL_MARGIN_PX = 12;
const MOMENTUM_STOP_PX_PER_S = 20;
const SAMPLE_KEEP_MS = VELOCITY_WINDOW_MS + 80;
const MOUSE_ID = -1;

interface Pending {
  kind: "pending";
  id: number;
  x0: number;
  y0: number;
  t0: number;
  region: Region;
  targetKind: TargetKind;
  body: HTMLElement;
  /** The touch stopped the sheet or its list mid-motion. */
  caught: boolean;
}

interface Drag {
  kind: "drag";
  id: number;
  lastY: number;
  /** Position before rubber-banding. */
  rawY: number;
  samples: MoveSample[];
  body: HTMLElement;
  bodyLinked: boolean;
  maxScroll: number;
  /** Whichever took the last part of the motion. */
  mover: "sheet" | "body" | null;
}

interface Passed {
  kind: "pass";
  id: number;
}

/** A downward native scroll of the list. Watched rather than owned: if the
 *  list reaches its top while the finger keeps pulling, the sheet takes the
 *  rest of the pull, as native sheets do. The moves can no longer be
 *  cancelled by then, so the sheet only follows them; measured on the A73,
 *  they keep arriving at the input rate after the top. */
interface NativeScroll {
  kind: "native";
  id: number;
  body: HTMLElement;
  lastY: number;
  /** The sheet has taken over the pull. */
  handed: boolean;
  /** Where the sheet was when it took over; it never rises above this. */
  startY: number;
  rawY: number;
  samples: MoveSample[];
  /** The list's own inline overflow-y, restored when the pull ends. */
  prevOverflowY: string;
}

export class SheetController {
  private readonly els: SheetElements;
  private readonly cb: SheetCallbacks;
  private g: SheetGeometry | null = null;
  /** The snap the sheet rests at, or is animating to. */
  private current: Snap = "dismissed";
  private shownY = 0;
  /** False while dragged, or after being caught mid-animation. */
  private resting = true;
  private exiting = false;
  private playback: Playback | null = null;
  private gesture: Pending | Drag | Passed | NativeScroll | null = null;
  private momentumFrame = 0;
  private suppressClickUntil = 0;
  private cleanups: Array<() => void> = [];
  private mouseCleanup: (() => void) | null = null;

  constructor(els: SheetElements, cb: SheetCallbacks) {
    this.els = els;
    this.cb = cb;
  }

  get snap(): Snap {
    return this.current;
  }

  /** Where the sheet is drawn, or (mid-animation) where it is going. */
  get y(): number {
    return this.shownY;
  }

  setGeometry(g: SheetGeometry, animate = false): void {
    const prev = this.g;
    this.g = g;
    if (prev && sameGeometry(prev, g)) return;
    if (this.gesture?.kind === "drag") return;
    if (this.current === "full" && !g.expandable) this.current = "default";
    const to = snapY(this.current, g);
    if (this.exiting) {
      if (this.playback) {
        this.play(
          easeSamples(this.currentY(), to, MOTION.fast, EASE_POINTS.exit),
          MOTION.fast,
          () => this.cb.onExitFinished(),
        );
      } else {
        this.apply(to);
      }
      return;
    }
    // A running enter/settle is retargeted rather than cut short: the first
    // ResizeObserver callback lands right after mount, mid-enter.
    if (animate || this.playback) {
      this.play(
        easeSamples(this.currentY(), to, MOTION.med, EASE_POINTS.enter),
        MOTION.med,
      );
    } else {
      this.apply(to);
    }
  }

  open(): void {
    const g = this.g;
    if (!g) return;
    this.exiting = false;
    this.resting = true;
    this.current = "default";
    const from = snapY("dismissed", g);
    this.apply(from);
    this.play(
      easeSamples(from, snapY("default", g), MOTION.med, EASE_POINTS.enter),
      MOTION.med,
    );
  }

  /** Slide off the bottom. With a release velocity it is a spring that
   *  carries the flick; without one (scrim tap, Back, Esc) the exit ease. */
  close(velocity?: number): void {
    const g = this.g;
    if (!g) {
      this.cb.onExitFinished();
      return;
    }
    if (this.exiting) return;
    this.exiting = true;
    this.resting = true;
    this.current = "dismissed";
    this.cancelGesture();
    this.stopMomentum();
    const from = this.currentY();
    const to = snapY("dismissed", g);
    const done = () => this.cb.onExitFinished();
    if (velocity) {
      const s = springSamples(from, to, velocity);
      this.play(s, (s.length - 1) * FRAME_MS, done);
    } else {
      this.play(
        easeSamples(from, to, MOTION.fast, EASE_POINTS.exit),
        MOTION.fast,
        done,
      );
    }
  }

  settleTo(snap: "full" | "default", velocity: number): void {
    const g = this.g;
    if (!g) return;
    this.exiting = false;
    this.resting = true;
    this.current = snap === "full" && !g.expandable ? "default" : snap;
    const s = springSamples(this.currentY(), snapY(this.current, g), velocity);
    this.play(s, (s.length - 1) * FRAME_MS);
  }

  /** Programmatic expand (wheel, reveal): the open ease, not a spring. */
  expand(): void {
    const g = this.g;
    if (!g || !g.expandable || this.exiting) return;
    if (this.current === "full" && this.resting && !this.playback) return;
    this.current = "full";
    this.resting = true;
    this.play(
      easeSamples(this.currentY(), 0, MOTION.med, EASE_POINTS.enter),
      MOTION.med,
    );
  }

  /** Bring `el` (inside the sheet's list) fully into view: expand first when
   *  that helps, then scroll the list by computed offset. Never
   *  scrollIntoView, which also scrolls the sheet's clip window (see
   *  panels/tocReveal.ts for the history). */
  reveal(el: HTMLElement): void {
    const g = this.g;
    if (!g || this.exiting) return;
    const limit = g.viewportH - this.els.footer.offsetHeight - REVEAL_MARGIN_PX;
    let bottom = el.getBoundingClientRect().bottom;
    if (bottom <= limit) return;
    if (g.expandable && this.current !== "full") {
      bottom += snapY("full", g) - this.currentY();
      this.expand();
    }
    const over = bottom - limit;
    if (over <= 0) return;
    const body = findBody(this.els.content);
    body.scrollTo({
      top: body.scrollTop + over,
      behavior: isReducedMotion() ? "instant" : "smooth",
    });
  }

  touchStart(p: TouchPoint): void {
    const g = this.g;
    if (!g || this.exiting) return;
    // One finger at a time: a second touch is ignored until the first ends.
    if (this.gesture) return;
    // A touch that stops something moving (the sheet mid-animation, or a list
    // still coasting) is consumed: lifting it must not tap what is under it.
    const caught = this.momentumFrame !== 0 || this.playback !== null;
    this.stopMomentum();
    if (this.playback) {
      // Caught mid-flight: stop under the finger and carry on from there.
      this.stopPlayback();
      this.resting = false;
    }
    const body = findBody(this.els.content);
    const { region, kind } = classifyTarget(p.target, body);
    if (p.mouse && region !== "chrome") return;
    this.gesture = {
      kind: "pending",
      id: p.id,
      x0: p.x,
      y0: p.y,
      t0: p.t,
      region,
      targetKind: kind,
      body,
      caught,
    };
  }

  /** Returns true when the caller must preventDefault the move. */
  touchMove(p: Omit<TouchPoint, "target"> & { cancelable: boolean }): boolean {
    const g = this.g;
    const gs = this.gesture;
    if (!g || !gs || gs.id !== p.id || gs.kind === "pass") return false;
    if (gs.kind === "native") {
      this.followNativePull(gs, p, g);
      return false;
    }
    if (gs.kind === "pending") {
      const dx = p.x - gs.x0;
      const dy = p.y - gs.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return false;
      const owner = decideOwner({
        region: gs.region,
        kind: gs.targetKind,
        dx,
        dy,
        cancelable: p.cancelable,
        atTopSnap: this.resting && this.current === topSnap(g),
        expandable: g.expandable,
        bodyScrollTop: gs.body.scrollTop,
        bodyScrollable: isScrollableY(gs.body),
      });
      if (owner === "pass") {
        this.gesture =
          gs.region === "body" && dy > 0
            ? {
                kind: "native",
                id: gs.id,
                body: gs.body,
                lastY: p.y,
                handed: false,
                startY: this.shownY,
                rawY: this.shownY,
                samples: [],
                prevOverflowY: "",
              }
            : { kind: "pass", id: gs.id };
        return false;
      }
      this.resting = false;
      this.gesture = {
        kind: "drag",
        id: gs.id,
        lastY: gs.y0,
        rawY: this.shownY,
        samples: [{ y: gs.y0, t: gs.t0 }],
        body: gs.body,
        bodyLinked: gs.region === "body" && isScrollableY(gs.body),
        maxScroll: Math.max(0, gs.body.scrollHeight - gs.body.clientHeight),
        mover: null,
      };
    }
    const d = this.gesture as Drag;
    const delta = p.y - d.lastY;
    d.lastY = p.y;
    const r = distribute({
      delta,
      sheetY: d.rawY,
      minY: snapY(topSnap(g), g),
      scrollTop: d.body.scrollTop,
      maxScroll: d.maxScroll,
      bodyLinked: d.bodyLinked,
    });
    d.rawY = r.sheetY;
    if (d.bodyLinked && r.scrollTop !== d.body.scrollTop) {
      d.body.scrollTop = r.scrollTop;
    }
    if (r.mover) d.mover = r.mover;
    d.samples.push({ y: p.y, t: p.t });
    while (d.samples.length > 2 && p.t - d.samples[0].t > SAMPLE_KEEP_MS) {
      d.samples.shift();
    }
    this.apply(displayY(d.rawY, g));
    return true;
  }

  touchEnd(p: { id: number; t: number }): void {
    const g = this.g;
    const gs = this.gesture;
    if (!gs || gs.id !== p.id) return;
    this.gesture = null;
    if (gs.kind === "native") this.unfreezeList(gs);
    if (!g || this.exiting) return;
    if (gs.kind === "native" && gs.handed && gs.rawY > gs.startY + 0.5) {
      const v = this.releaseVelocity(gs.samples, p.t);
      const target = pickSnap(this.shownY, v, g);
      if (target === "dismissed") {
        this.cb.onDismiss();
        this.close(v);
      } else {
        this.settleTo(target, v);
      }
      return;
    }
    if (gs.kind !== "drag") {
      if (gs.kind === "pending" && gs.caught) {
        this.suppressClickUntil = p.t + CLICK_SUPPRESS_MS;
      }
      // A tap (or a native scroll) that caught the sheet mid-animation:
      // finish going where it was going.
      if (!this.resting) {
        this.settleTo(this.current === "full" ? "full" : "default", 0);
      }
      return;
    }
    this.suppressClickUntil = p.t + CLICK_SUPPRESS_MS;
    const v = this.releaseVelocity(gs.samples, p.t);
    const top = snapY(topSnap(g), g);
    if (gs.mover === "body" && gs.rawY === top) {
      // "Expand, then keep scrolling": the sheet rests at its top snap and
      // the list keeps the fling.
      this.current = topSnap(g);
      this.resting = true;
      this.apply(top);
      if (v !== 0) this.startMomentum(gs.body, -v, p.t);
      return;
    }
    const target = pickSnap(this.shownY, v, g);
    if (target === "dismissed") {
      // Tell the owner first so its open=false finds the exit running.
      this.cb.onDismiss();
      this.close(v);
      return;
    }
    this.settleTo(target, v);
  }

  /** Returns true when the caller must preventDefault the wheel event. */
  wheel(deltaY: number): boolean {
    const g = this.g;
    if (!g || !g.expandable || this.exiting || deltaY <= 0) return false;
    if (this.current === "full") return false;
    this.expand();
    return true;
  }

  /** One-shot: true for the first click inside the window after a drag. */
  suppressesClick(t: number): boolean {
    if (t < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  attach(): void {
    const box = this.els.box;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts: AddEventListenerOptions,
    ) => {
      box.addEventListener(type, fn, opts);
      this.cleanups.push(() => box.removeEventListener(type, fn, opts));
    };
    // Synthetic touch events (tests, other code poking the reader) can arrive
    // without touch lists; they are not gestures.
    const touchOf = (e: TouchEvent): Touch | null => {
      const list = e.changedTouches;
      if (!list) return null;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!this.gesture || t.identifier === this.gesture.id) return t;
      }
      return null;
    };
    on(
      "touchstart",
      (e) => {
        const t = e.changedTouches?.[0];
        if (!t) return;
        this.touchStart({
          id: t.identifier,
          x: t.clientX,
          y: t.clientY,
          t: performance.now(),
          target: e.target as Element,
        });
      },
      { passive: true },
    );
    // The one blocking listener: it must be able to preventDefault the first
    // move of a gesture the sheet owns. On the sheet, never on document, and
    // only while the sheet is mounted.
    on(
      "touchmove",
      (e) => {
        const t = touchOf(e);
        if (!t) return;
        const claimed = this.touchMove({
          id: t.identifier,
          x: t.clientX,
          y: t.clientY,
          t: performance.now(),
          cancelable: e.cancelable,
        });
        if (claimed && e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      const t = touchOf(e);
      if (t) this.touchEnd({ id: t.identifier, t: performance.now() });
    };
    on("touchend", end, { passive: true });
    on("touchcancel", end, { passive: true });
    on(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        this.touchStart({
          id: MOUSE_ID,
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          target: e.target as Element,
          mouse: true,
        });
        if (this.gesture?.id !== MOUSE_ID) return;
        const move = (ev: PointerEvent) => {
          const claimed = this.touchMove({
            id: MOUSE_ID,
            x: ev.clientX,
            y: ev.clientY,
            t: performance.now(),
            cancelable: true,
          });
          if (claimed) ev.preventDefault();
        };
        const up = () => {
          this.touchEnd({ id: MOUSE_ID, t: performance.now() });
          cleanup();
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          this.mouseCleanup = null;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        this.mouseCleanup = cleanup;
      },
      { passive: true },
    );
    on(
      "wheel",
      (e) => {
        if (this.wheel(e.deltaY)) e.preventDefault();
      },
      { passive: false },
    );
    on(
      "click",
      (e) => {
        if (this.suppressesClick(performance.now())) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true },
    );
  }

  destroy(): void {
    for (const off of this.cleanups) off();
    this.cleanups = [];
    this.cancelGesture();
    this.stopMomentum();
    this.playback?.cancel();
    this.playback = null;
  }

  private apply(y: number): void {
    const g = this.g;
    if (!g) return;
    this.shownY = y;
    this.els.box.style.transform = `translateY(${y}px)`;
    this.els.scrim.style.opacity = String(scrimOpacity(y, g));
    this.els.footer.style.transform = `translateY(${footerOffset(y, g)}px)`;
  }

  /** Where the sheet is drawn right now, including mid-animation. */
  private currentY(): number {
    return this.playback ? readTranslateY(this.els.box) : this.shownY;
  }

  private stopPlayback(): void {
    if (!this.playback) return;
    const y = readTranslateY(this.els.box);
    this.playback.cancel();
    this.playback = null;
    this.apply(y);
  }

  private play(values: number[], durationMs: number, onDone?: () => void) {
    const g = this.g;
    if (!g) return;
    this.stopPlayback();
    const end = values[values.length - 1];
    if (isReducedMotion() || values.length < 2) {
      this.apply(end);
      onDone?.();
      return;
    }
    const pb = playTracks(
      [
        {
          el: this.els.box,
          prop: "transform",
          values: values.map((v) => `translateY(${v}px)`),
        },
        {
          el: this.els.scrim,
          prop: "opacity",
          values: values.map((v) => String(scrimOpacity(v, g))),
        },
        {
          el: this.els.footer,
          prop: "transform",
          values: values.map((v) => `translateY(${footerOffset(v, g)}px)`),
        },
      ],
      durationMs,
    );
    this.playback = pb;
    this.shownY = end;
    void pb.finished.then((done) => {
      if (this.playback !== pb) return;
      this.playback = null;
      if (done) onDone?.();
    });
  }

  private startMomentum(body: HTMLElement, v: number, t0: number): void {
    this.stopMomentum();
    let vel = v;
    let last = t0;
    const step = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      const max = Math.max(0, body.scrollHeight - body.clientHeight);
      const next = Math.min(
        max,
        Math.max(0, body.scrollTop + (vel * dt) / 1000),
      );
      body.scrollTop = next;
      vel *= MOMENTUM_DECAY_PER_MS ** dt;
      if (next <= 0 || next >= max || Math.abs(vel) < MOMENTUM_STOP_PX_PER_S) {
        this.momentumFrame = 0;
        return;
      }
      this.momentumFrame = requestAnimationFrame(step);
    };
    this.momentumFrame = requestAnimationFrame(step);
  }

  private stopMomentum(): void {
    if (this.momentumFrame) cancelAnimationFrame(this.momentumFrame);
    this.momentumFrame = 0;
  }

  private cancelGesture(): void {
    if (this.gesture?.kind === "native") this.unfreezeList(this.gesture);
    this.gesture = null;
    this.mouseCleanup?.();
  }

  /** A finger that stopped before lifting carries no velocity. */
  private releaseVelocity(samples: MoveSample[], t: number): number {
    const last = samples[samples.length - 1];
    if (!last || t - last.t > VELOCITY_WINDOW_MS) return 0;
    return velocityFromSamples(samples);
  }

  private followNativePull(
    gs: NativeScroll,
    p: { y: number; t: number },
    g: SheetGeometry,
  ): void {
    const delta = p.y - gs.lastY;
    gs.lastY = p.y;
    if (!gs.handed) {
      // Still the list's scroll until it is at its top and the finger keeps
      // pulling down. This move's travel went into the list; the sheet takes
      // over from the next one.
      if (delta <= 0 || gs.body.scrollTop > 0) return;
      gs.handed = true;
      gs.startY = this.shownY;
      gs.rawY = this.shownY;
      gs.samples = [{ y: p.y, t: p.t }];
      this.resting = false;
      // Freeze the list while the sheet is off its snap: the browser still
      // owns this gesture, and a reversal would otherwise scroll the list
      // underneath the moving sheet.
      gs.prevOverflowY = gs.body.style.overflowY;
      gs.body.style.overflowY = "hidden";
      return;
    }
    gs.rawY = Math.min(
      snapY("dismissed", g),
      Math.max(gs.startY, gs.rawY + delta),
    );
    gs.samples.push({ y: p.y, t: p.t });
    while (gs.samples.length > 2 && p.t - gs.samples[0].t > SAMPLE_KEEP_MS) {
      gs.samples.shift();
    }
    this.apply(gs.rawY);
  }

  private unfreezeList(gs: NativeScroll): void {
    if (gs.handed) gs.body.style.overflowY = gs.prevOverflowY;
  }
}

function sameGeometry(a: SheetGeometry, b: SheetGeometry): boolean {
  return (
    a.viewportH === b.viewportH &&
    a.insetTop === b.insetTop &&
    a.boxH === b.boxH &&
    a.defaultVisibleH === b.defaultVisibleH &&
    a.expandable === b.expandable
  );
}
