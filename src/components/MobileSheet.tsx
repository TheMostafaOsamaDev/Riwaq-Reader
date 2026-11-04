// The bottom sheet every phone and tablet surface uses: the reader's
// Contents / Highlights / Settings / Progress, the PDF and DOCX panels, the
// ⋮ action menus, the library's long-press book menu, the download-range
// picker, the update sheet and What's new.
//
// This component is lifecycle and layout only. Where the sheet is and how
// it moves belong to SheetController (sheet/SheetController.ts), which writes
// transform and opacity straight to the DOM: a drag never re-renders the
// sheet or its contents. Behaviour is specified in
// docs/superpowers/specs/2026-11-04-native-feel-sheets-design.md.
//
// Layout. An expandable sheet's box is laid out at full height (top edge on
// the safe-area inset) and translated down to its default snap, so expanding
// is a transform with no relayout. A sheet that cannot expand is laid out
// exactly as tall as its default snap. Either way the box reaches OVERDRAW_PX
// below the screen edge in the sheet colour, so a rubber-band or spring
// overshoot past the top never lifts its bottom off the screen.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { pushLayer } from "../store/navigation";
import type { Theme } from "../styles/tokens";
import { Z } from "../styles/tokens";
import {
  AUTO_HEIGHT_CAP,
  OVERDRAW_PX,
  type SheetGeometry,
} from "./sheet/physics";
import { SheetController } from "./sheet/SheetController";
import { type SheetApi, SheetContext } from "./sheet/SheetContext";

interface Props {
  theme: Theme;
  /** Controls visibility. Flip to false to dismiss with animation. */
  open: boolean;
  /** Called when the user taps the scrim, presses Back or Esc, or drags or
   *  flicks the sheet closed. */
  onClose: () => void;
  children: ReactNode;
  /** Visible height at the default snap: "82%", "min(80%, 500px)", any CSS
   *  length, or "auto" to fit the content (capped at 90% of the screen).
   *  Default "82%". */
  height?: string;
  /** Whether the sheet can be raised to full screen. Default true; always
   *  false for height="auto". */
  expandable?: boolean;
  /** aria-label for the dialog. */
  label?: string;
  /** After the exit animation has finished and the sheet has unmounted. */
  onExited?: () => void;
}

const FULL_INSET_TOP_FALLBACK = 24;

/** Read `env(safe-area-inset-top)` off a probe element, so the value matches
 *  what the browser actually applies. */
function readSafeAreaInsetTop(): number {
  if (typeof document === "undefined") return FULL_INSET_TOP_FALLBACK;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.height = `env(safe-area-inset-top, ${FULL_INSET_TOP_FALLBACK}px)`;
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return px > 0 ? px : FULL_INSET_TOP_FALLBACK;
}

function parseHeightPx(heightProp: string, viewportH: number): number {
  const trimmed = heightProp.trim();
  if (trimmed.endsWith("%")) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (Number.isFinite(pct)) return (pct / 100) * viewportH;
  }
  if (trimmed.endsWith("px")) {
    const px = Number.parseFloat(trimmed.slice(0, -2));
    if (Number.isFinite(px)) return px;
  }
  // Anything else — `min(70%, 460px)`, `clamp(...)`, `40vh` — is resolved by
  // the browser off a throwaway element. A short form sheet wants "as tall
  // as its content, but never more than N% of the screen", which no single
  // unit can express.
  const measured = measureCssLengthPx(trimmed, viewportH);
  if (measured !== null) return measured;
  // Unresolvable — fall back to 82% so the sheet still works.
  return 0.82 * viewportH;
}

/** Resolve a CSS length to pixels by letting the browser compute it, with
 *  percentages taken against the viewport height. Null without a DOM or for
 *  an invalid value. */
function measureCssLengthPx(value: string, viewportH: number): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const parent = document.createElement("div");
  parent.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;width:0;";
  parent.style.height = `${viewportH}px`;
  const probe = document.createElement("div");
  probe.style.height = value;
  parent.appendChild(probe);
  document.body.appendChild(parent);
  const px = probe.getBoundingClientRect().height;
  document.body.removeChild(parent);
  return Number.isFinite(px) && px > 0 ? px : null;
}

export function MobileSheet({
  theme,
  open,
  onClose,
  children,
  height = "82%",
  expandable = true,
  label,
  onExited,
}: Props) {
  const [mounted, setMounted] = useState(open);
  // Mount as soon as `open` turns true; the frame below animates it in.
  if (open && !mounted) setMounted(true);

  // Freeze the children while the sheet animates out: callers commonly clear
  // the data the sheet showed in the same update that closes it.
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Back: while open, the sheet owns a history entry, so the system Back
  // (and a mouse back button) closes it instead of leaving the screen.
  useEffect(() => {
    if (!open) return;
    return pushLayer(() => onCloseRef.current());
  }, [open]);

  // Esc. On window, so a control inside the sheet (an open dropdown) that
  // handles Esc on the document first can claim it with preventDefault.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleExited = useCallback(() => {
    setMounted(false);
    onExitedRef.current?.();
  }, []);

  if (!mounted) return null;
  const fit = height.trim() === "auto";
  return (
    <SheetFrame
      theme={theme}
      open={open}
      height={height}
      fit={fit}
      expandable={expandable && !fit}
      label={label}
      onCloseRef={onCloseRef}
      onExited={handleExited}
    >
      {open ? children : lastChildrenRef.current}
    </SheetFrame>
  );
}

function SheetFrame({
  theme,
  open,
  height,
  fit,
  expandable,
  label,
  onCloseRef,
  onExited,
  children,
}: {
  theme: Theme;
  open: boolean;
  height: string;
  fit: boolean;
  expandable: boolean;
  label?: string;
  onCloseRef: { current: () => void };
  onExited: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<SheetController | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const setFooter = useCallback((el: HTMLDivElement | null) => {
    footerRef.current = el;
    setFooterSlot(el);
  }, []);

  const layoutRef = useRef({ height, fit, expandable });
  layoutRef.current = { height, fit, expandable };

  /** Measure the screen, size the box, and hand the geometry to the engine. */
  const measure = useCallback((animate: boolean) => {
    const box = boxRef.current;
    const ctrl = ctrlRef.current;
    if (!box || !ctrl) return;
    const { height: h, fit: f, expandable: x } = layoutRef.current;
    const viewportH = window.innerHeight || 0;
    const insetTop = readSafeAreaInsetTop();
    const full = Math.max(0, viewportH - insetTop);
    let g: SheetGeometry;
    if (f) {
      // Content-sized: let layout decide, capped, then read it back.
      box.style.height = "auto";
      box.style.maxHeight = `${Math.min(full, Math.round(viewportH * AUTO_HEIGHT_CAP)) + OVERDRAW_PX}px`;
      const boxH = Math.max(0, box.offsetHeight - OVERDRAW_PX);
      g = {
        viewportH,
        insetTop,
        boxH,
        defaultVisibleH: boxH,
        expandable: false,
      };
    } else {
      const def = Math.min(full, parseHeightPx(h, viewportH));
      const boxH = x ? full : def;
      box.style.height = `${boxH + OVERDRAW_PX}px`;
      box.style.maxHeight = "";
      g = { viewportH, insetTop, boxH, defaultVisibleH: def, expandable: x };
    }
    ctrl.setGeometry(g, animate);
  }, []);

  // The engine, created once per mount, before the first paint.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const scrim = scrimRef.current;
    const content = contentRef.current;
    const footer = footerRef.current;
    if (!box || !scrim || !content || !footer) return;
    const ctrl = new SheetController(
      { box, scrim, content, footer },
      { onDismiss: () => onCloseRef.current(), onExitFinished: onExited },
    );
    ctrlRef.current = ctrl;
    ctrl.attach();
    measure(false);
    ctrl.open();
    return () => {
      ctrl.destroy();
      ctrlRef.current = null;
    };
  }, [measure, onCloseRef, onExited]);

  // `open` after mount: close, or come back if reopened mid-exit.
  const firstOpenRef = useRef(true);
  useLayoutEffect(() => {
    if (firstOpenRef.current) {
      firstOpenRef.current = false;
      return;
    }
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (open) ctrl.settleTo("default", 0);
    else ctrl.close();
  }, [open]);

  // A new height while open (the update sheet switching views) animates.
  const lastHeightRef = useRef(height);
  useLayoutEffect(() => {
    if (lastHeightRef.current === height) return;
    lastHeightRef.current = height;
    measure(true);
  }, [height, measure]);

  // Rotation, the keyboard, immersive mode toggling the system bars, and
  // (for "auto") the content changing height.
  useEffect(() => {
    const onResize = () => measure(false);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    if (rootRef.current) ro?.observe(rootRef.current);
    if (fit && contentRef.current) ro?.observe(contentRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [fit, measure]);

  const api = useMemo<SheetApi>(
    () => ({
      reveal: (el) => ctrlRef.current?.reveal(el),
      footerSlot,
    }),
    [footerSlot],
  );

  return (
    // Clipping here is load-bearing. The sheet is absolutely positioned and
    // translated, and a transformed box still contributes to its ancestor's
    // scrollable overflow: without the clip the reader root grew a scroll
    // area as tall as the sheet's off-screen tail and got scrolled to it,
    // shoving the page up as the sheet opened. `.riwaq-clip-window`
    // (global.css) upgrades `hidden` to `overflow: clip`, which also stops
    // this element from being scrolled by a scrollIntoView inside the sheet.
    <div
      ref={rootRef}
      className="riwaq-clip-window"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: Z.panel,
        overflow: "hidden",
      }}
    >
      {/* opacity is written by the engine, never by React. */}
      <div
        ref={scrimRef}
        data-sheet-scrim
        onClick={() => onCloseRef.current()}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
        }}
      />
      {/* transform and height are written by the engine, never by React. */}
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-sheet-box
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: -OVERDRAW_PX,
          paddingBottom: OVERDRAW_PX,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          background: theme.bg,
          color: theme.ink,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          boxShadow: "0 -10px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
          willChange: "transform",
        }}
      >
        <div
          data-sheet-grabber
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 8,
            flexShrink: 0,
            touchAction: "none",
            cursor: "grab",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: theme.rule,
            }}
          />
        </div>
        {/* The default list: when the children have no
            [data-sheet-scrollable] of their own, this scrolls. */}
        <div
          ref={contentRef}
          data-sheet-content
          style={{
            flex: fit ? "0 1 auto" : "1 1 0",
            minHeight: 0,
            overflowY: "auto",
            overscrollBehaviorY: "contain",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SheetContext.Provider value={api}>{children}</SheetContext.Provider>
        </div>
        {/* SheetFooter portals here; transform is written by the engine. */}
        <div
          ref={setFooter}
          data-sheet-footer
          style={{ flexShrink: 0, background: theme.bg }}
        />
      </div>
    </div>
  );
}
