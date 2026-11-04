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
// physics.ts; the DOM events are input.ts. The release velocity and the
// coast after an "expand, then keep scrolling" swipe are the reader's own
// (reader/scroll), so a list moved by the sheet decelerates exactly like the
// native one beside it.

import { canScrollY } from "../../lib/scrollable";
import { stayedPut } from "../../reader/gestureAxis";
import { type Fling, flingScroller } from "../../reader/scroll/flingScroller";
import { type PanSample, releaseVelocity } from "../../reader/scroll/touchPan";
import { EASE_POINTS, isReducedMotion, MOTION } from "../../styles/motion";
import { type Playback, playTracks } from "./animate";
import {
  classifyTarget,
  decideOwner,
  findBody,
  type Region,
  readTranslateY,
  type TargetKind,
} from "./gesture";
import {
  bindSheetInput,
  type MovePoint,
  type SheetInput,
  type TouchPoint,
} from "./input";
import {
  displayY,
  distribute,
  easeSamples,
  footerOffset,
  pickSnap,
  type Samples,
  type SheetGeometry,
  type Snap,
  scrimOpacity,
  snapY,
  springSamples,
  topSnap,
} from "./physics";

export type { TouchPoint } from "./input";

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

/** How long after a drag a click is still treated as part of it. */
const CLICK_SUPPRESS_MS = 400;
/** Gap kept between a revealed element and the visible bottom. */
const REVEAL_MARGIN_PX = 12;
/** Samples kept for the release velocity (touchPan reads the last 100ms). */
const SAMPLE_KEEP_MS = 200;

/** A finger down, not yet past the slop. */
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

/** The sheet owns the gesture. */
interface Drag {
  kind: "drag";
  id: number;
  lastY: number;
  /** Position before rubber-banding. */
  rawY: number;
  samples: PanSample[];
  body: HTMLElement;
  bodyLinked: boolean;
  maxScroll: number;
  /** Whichever took the last part of the motion. */
  mover: "sheet" | "body" | null;
}

/** A native downward scroll of the list, watched rather than owned: if the
 *  list reaches its top while the finger keeps pulling, the sheet takes the
 *  rest of the pull, as native sheets do. The moves can no longer be
 *  cancelled by then, so the sheet only follows them; measured on the A73,
 *  they keep arriving at the input rate after the top. */
interface Watch {
  kind: "watch";
  id: number;
  body: HTMLElement;
  lastY: number;
  /** The sheet has taken over the pull. */
  handed: boolean;
  /** Where the sheet was when it took over; it never rises above this. */
  startY: number;
  rawY: number;
  /** The list's own inline overflow-y, restored when the pull ends. */
  prevOverflowY: string;
}

/** The browser's gesture (a sideways swipe, a slider, a text selection, an
 *  upward list scroll): the sheet stays out of it. */
interface Passed {
  kind: "pass";
  id: number;
}

type Gesture = Pending | Drag | Watch | Passed;

export class SheetController implements SheetInput {
  private readonly els: SheetElements;
  private readonly cb: SheetCallbacks;
  private g: SheetGeometry | null = null;
  /** The snap the sheet rests at, or is animating to. */
  private current: Snap = "dismissed";
  private shownY = 0;
  /** A finger has moved the sheet off `current`, or caught it mid-flight:
   *  it is not on its way anywhere until a release settles it. */
  private displaced = false;
  private exiting = false;
  private playback: Playback | null = null;
  private gesture: Gesture | null = null;
  private fling: Fling | null = null;
  private suppressClickUntil = 0;
  private unbind: (() => void) | null = null;

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

  /** Start listening to the sheet box (see input.ts). */
  attach(): void {
    this.unbind ??= bindSheetInput(this.els.box, this);
  }

  destroy(): void {
    this.unbind?.();
    this.unbind = null;
    this.dropGesture();
    this.stopFling();
    this.playback?.cancel();
    this.playback = null;
  }

  /** Take a new layout. The box has just been re-laid out for `g`, so the
   *  drawn position is carried over keeping the sheet's top edge where it
   *  was; from there it moves to its snap — animated when asked (a `height`
   *  change), or already mid-animation. Otherwise a resize (the update sheet
   *  going 52% → 86%) would start from a position that only meant something
   *  in the old layout. */
  setGeometry(g: SheetGeometry, animate = false): void {
    const prev = this.g;
    this.g = g;
    if (prev && sameGeometry(prev, g)) return;
    const shift = prev
      ? g.boxH - prev.boxH - (g.viewportH - prev.viewportH)
      : 0;
    const gs = this.gesture;
    if (gs?.kind === "drag" || (gs?.kind === "watch" && gs.handed)) {
      gs.rawY += shift;
      if (gs.kind === "watch") gs.startY += shift;
      this.apply(displayY(gs.rawY, g));
      return;
    }
    if (this.current === "full" && !g.expandable) this.current = "default";
    const to = snapY(this.current, g);
    if (!animate && !this.playback) {
      this.apply(to);
      return;
    }
    const from = this.currentY() + shift;
    this.apply(from);
    if (this.exiting) {
      this.play(this.ease("exit", from, to), this.cb.onExitFinished);
    } else {
      this.play(this.ease("enter", from, to));
    }
  }

  open(): void {
    const g = this.g;
    if (!g) return;
    this.exiting = false;
    this.displaced = false;
    this.current = "default";
    const from = snapY("dismissed", g);
    this.apply(from);
    this.play(this.ease("enter", from, snapY("default", g)));
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
    this.displaced = false;
    this.current = "dismissed";
    this.dropGesture();
    this.stopFling();
    const from = this.currentY();
    const to = snapY("dismissed", g);
    this.play(
      velocity
        ? springSamples(from, to, velocity)
        : this.ease("exit", from, to),
      this.cb.onExitFinished,
    );
  }

  settleTo(snap: "full" | "default", velocity: number): void {
    const g = this.g;
    if (!g) return;
    this.exiting = false;
    this.displaced = false;
    this.current = snap === "full" && !g.expandable ? "default" : snap;
    this.play(springSamples(this.currentY(), snapY(this.current, g), velocity));
  }

  /** Programmatic expand (wheel, reveal): the open ease, not a spring. */
  expand(): void {
    const g = this.g;
    if (!g || !g.expandable || this.exiting) return;
    if (this.current === "full" && !this.displaced && !this.playback) return;
    this.current = "full";
    this.displaced = false;
    this.play(this.ease("enter", this.currentY(), 0));
  }

  /** Bring `el` (inside the sheet's list) fully into view: expand first when
   *  that helps, then scroll the list by computed offset. Never
   *  scrollIntoView, which also scrolls the sheet's clip window (see
   *  panels/tocReveal.ts for the history). */
  reveal(el: HTMLElement): void {
    const g = this.g;
    if (!g || this.exiting) return;
    const limit = g.viewportH - this.els.footer.offsetHeight - REVEAL_MARGIN_PX;
    // Measured where the sheet will rest, not where it is drawn: two reveals
    // can land in one expand (a focused search box, then the list it opens).
    const resting = snapY(this.current, g);
    let bottom = el.getBoundingClientRect().bottom + resting - this.currentY();
    if (bottom <= limit) return;
    if (g.expandable && this.current !== "full") {
      bottom += snapY("full", g) - resting;
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

  // ── Input (see input.ts for the DOM side) ────────────────────────────────

  touchStart(p: TouchPoint): void {
    if (!this.g || this.exiting || this.gesture) return;
    const body = findBody(this.els.content);
    const { region, kind } = classifyTarget(p.target, body);
    // A mouse press on the list is a click or a text selection, never a
    // drag: leave everything — a running settle included — alone.
    if (p.mouse && region !== "chrome") return;
    // A touch that stops something moving (the sheet mid-animation, or a list
    // still coasting) is consumed: lifting it must not tap what is under it.
    const caught = this.fling?.active === true || this.playback !== null;
    this.stopFling();
    if (this.playback) {
      // Caught mid-flight: stop under the finger and carry on from there.
      this.stopPlayback();
      this.displaced = true;
    }
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

  touchMove(p: MovePoint): boolean {
    const g = this.g;
    const gs = this.gesture;
    if (!g || !gs || gs.id !== p.id) return false;
    switch (gs.kind) {
      case "pass":
        return false;
      case "watch":
        this.followWatch(gs, p, g);
        return false;
      case "drag":
        return this.dragTo(gs, p, g);
      case "pending": {
        const next = this.decide(gs, p, g);
        if (!next) return false;
        this.gesture = next;
        return next.kind === "drag" ? this.dragTo(next, p, g) : false;
      }
    }
  }

  touchEnd(p: { id: number; t: number }): void {
    const gs = this.gesture;
    if (!gs || gs.id !== p.id) return;
    this.gesture = null;
    if (gs.kind === "watch") this.unfreezeList(gs);
    if (!this.g || this.exiting) return;
    if (gs.kind === "drag") {
      this.releaseDrag(gs, p.t);
      return;
    }
    if (gs.kind === "pending" && gs.caught) {
      this.suppressClickUntil = p.t + CLICK_SUPPRESS_MS;
    }
    if (gs.kind === "watch" && gs.handed) {
      // A pull handed over from a native scroll never counts its speed: "a
      // fast flick through the list never closes the sheet" holds even when
      // the list runs out mid-flick. Only where it was pulled to decides.
      this.release(0);
      return;
    }
    // A tap (or a native scroll) that caught the sheet mid-animation: finish
    // going where it was going.
    if (this.displaced) {
      this.settleTo(this.current === "full" ? "full" : "default", 0);
    }
  }

  abandonGesture(): void {
    const displacedByIt =
      this.gesture?.kind === "drag" ||
      (this.gesture?.kind === "watch" && this.gesture.handed);
    this.dropGesture();
    if (displacedByIt && !this.exiting) this.release(0);
  }

  wheel(deltaY: number, target: Element): boolean {
    const g = this.g;
    if (!g || !g.expandable || this.exiting || deltaY <= 0) return false;
    if (this.current === "full") return false;
    // Over an inner list (the open font picker) the wheel scrolls that list.
    const body = findBody(this.els.content);
    if (classifyTarget(target, body).region === "nested") return false;
    this.expand();
    return true;
  }

  /** Focus moved to `target`. A control in the part of the list below the
   *  screen (Tab at the default snap) is brought into view: the browser's own
   *  focus scrolling only scrolls the list within its box, and that box
   *  hangs below the screen until the sheet expands. */
  focusIn(target: Element): void {
    const body = findBody(this.els.content);
    if (target === body || !body.contains(target)) return;
    if (target instanceof HTMLElement) this.reveal(target);
  }

  suppressesClick(t: number): boolean {
    if (t < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  // ── Gesture steps ────────────────────────────────────────────────────────

  /** What a pending touch becomes once it has left the slop, or null while
   *  it is still inside it. */
  private decide(gs: Pending, p: MovePoint, g: SheetGeometry): Gesture | null {
    const dx = p.x - gs.x0;
    const dy = p.y - gs.y0;
    if (stayedPut(dx, dy)) return null;
    const owner = decideOwner({
      region: gs.region,
      kind: gs.targetKind,
      dx,
      dy,
      cancelable: p.cancelable,
      atTopSnap: !this.displaced && this.current === topSnap(g),
      expandable: g.expandable,
      bodyScrollTop: gs.body.scrollTop,
      bodyScrollable: canScrollY(gs.body),
    });
    if (owner === "sheet") return this.beginDrag(gs);
    if (owner === "scroll" && dy > 0) {
      return {
        kind: "watch",
        id: gs.id,
        body: gs.body,
        lastY: p.y,
        handed: false,
        startY: 0,
        rawY: 0,
        prevOverflowY: "",
      };
    }
    return { kind: "pass", id: gs.id };
  }

  private beginDrag(gs: Pending): Drag {
    this.displaced = true;
    return {
      kind: "drag",
      id: gs.id,
      lastY: gs.y0,
      rawY: this.shownY,
      samples: [{ y: gs.y0, t: gs.t0 }],
      body: gs.body,
      bodyLinked: gs.region === "body" && canScrollY(gs.body),
      maxScroll: Math.max(0, gs.body.scrollHeight - gs.body.clientHeight),
      mover: null,
    };
  }

  private dragTo(d: Drag, p: MovePoint, g: SheetGeometry): boolean {
    const r = distribute({
      delta: p.y - d.lastY,
      sheetY: d.rawY,
      minY: snapY(topSnap(g), g),
      scrollTop: d.body.scrollTop,
      maxScroll: d.maxScroll,
      bodyLinked: d.bodyLinked,
    });
    d.lastY = p.y;
    d.rawY = r.sheetY;
    if (d.bodyLinked && r.scrollTop !== d.body.scrollTop) {
      d.body.scrollTop = r.scrollTop;
    }
    if (r.mover) d.mover = r.mover;
    pushSample(d.samples, p);
    this.apply(displayY(d.rawY, g));
    return true;
  }

  private releaseDrag(d: Drag, t: number): void {
    const g = this.g;
    if (!g) return;
    this.suppressClickUntil = t + CLICK_SUPPRESS_MS;
    const v = releaseVelocity(d.samples, t);
    const top = snapY(topSnap(g), g);
    if (d.mover === "body" && d.rawY === top) {
      // "Expand, then keep scrolling": the sheet rests at its top snap and
      // the list keeps the fling.
      this.current = topSnap(g);
      this.displaced = false;
      this.apply(top);
      this.fling = flingScroller(d.body, -v, t);
      return;
    }
    this.release(v);
  }

  /** Settle a released sheet where its position and speed send it. */
  private release(velocity: number): void {
    const g = this.g;
    if (!g) return;
    const target = pickSnap(this.shownY, velocity, g);
    if (target === "dismissed") {
      // Tell the owner first so its open=false finds the exit running.
      this.cb.onDismiss();
      this.close(velocity);
    } else {
      this.settleTo(target, velocity);
    }
  }

  private followWatch(gs: Watch, p: MovePoint, g: SheetGeometry): void {
    const delta = p.y - gs.lastY;
    gs.lastY = p.y;
    if (!gs.handed) {
      // Still the list's scroll until it is at its top and the finger keeps
      // pulling down. This move's travel went into the list; the sheet takes
      // over from the next one.
      if (delta <= 0 || gs.body.scrollTop > 0) return;
      gs.handed = true;
      gs.startY = gs.rawY = this.shownY;
      this.displaced = true;
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
    this.apply(gs.rawY);
  }

  private unfreezeList(gs: Watch): void {
    if (gs.handed) gs.body.style.overflowY = gs.prevOverflowY;
  }

  /** Forget the gesture without settling anything. */
  private dropGesture(): void {
    if (this.gesture?.kind === "watch") this.unfreezeList(this.gesture);
    this.gesture = null;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

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

  /** The app's open (enter) or close (exit) ease between two positions. */
  private ease(kind: "enter" | "exit", from: number, to: number): Samples {
    return kind === "enter"
      ? easeSamples(from, to, MOTION.med, EASE_POINTS.enter)
      : easeSamples(from, to, MOTION.fast, EASE_POINTS.exit);
  }

  private stopPlayback(): void {
    if (!this.playback) return;
    const y = readTranslateY(this.els.box);
    this.playback.cancel();
    this.playback = null;
    this.apply(y);
  }

  /** Animate through `s`: the sheet, its scrim and its footer from the same
   *  samples, on the compositor. With reduced motion, jump to the end. */
  private play(s: Samples, onDone?: () => void): void {
    const g = this.g;
    if (!g) return;
    this.stopPlayback();
    const { values } = s;
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
      s.durationMs,
    );
    this.playback = pb;
    this.shownY = end;
    void pb.finished.then((done) => {
      if (this.playback !== pb) return;
      this.playback = null;
      if (done) onDone?.();
    });
  }

  private stopFling(): void {
    this.fling?.cancel();
    this.fling = null;
  }
}

/** Record a finger sample, keeping only what the release velocity reads. */
function pushSample(samples: PanSample[], p: { y: number; t: number }): void {
  samples.push({ y: p.y, t: p.t });
  while (samples.length > 2 && p.t - samples[0].t > SAMPLE_KEEP_MS) {
    samples.shift();
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
