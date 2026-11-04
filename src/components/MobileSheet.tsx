// The bottom sheet every phone and tablet surface uses: the reader's
// Contents / Highlights / Settings / Progress, the PDF and DOCX panels, the
// ⋮ action menus, the library's long-press book menu, the download-range
// picker, the update sheet and What's new.
//
// This component is lifecycle only: mount, measure, open, close, unmount.
// Where the sheet is and how it moves belong to SheetController
// (sheet/SheetController.ts), which writes transform and opacity straight to
// the DOM, so a drag never re-renders the sheet or its contents; sizing is
// sheet/measure.ts. Behaviour is specified in
// docs/superpowers/specs/2026-11-04-native-feel-sheets-design.md.

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useBackLayer } from "../store/useBackLayer";
import type { Theme } from "../styles/tokens";
import { Z } from "../styles/tokens";
import {
  layOutSheet,
  readSafeAreaInsetTop,
  type SheetSizing,
} from "./sheet/measure";
import { OVERDRAW_PX } from "./sheet/physics";
import { SheetController } from "./sheet/SheetController";
import { type SheetApi, SheetProvider } from "./sheet/SheetContext";

interface CommonProps {
  theme: Theme;
  /** Controls visibility. Flip to false to dismiss with animation. */
  open: boolean;
  /** Called when the user taps the scrim, presses Back or Esc, or drags or
   *  flicks the sheet closed. */
  onClose: () => void;
  children: ReactNode;
  /** aria-label for the dialog. */
  label?: string;
  /** After the exit animation has finished and the sheet has unmounted. */
  onExited?: () => void;
}

/** Either as tall as its content (a menu: capped at 90% of the screen, never
 *  expands), or a set height with an optional full snap above it. */
type SizingProps =
  | { fitContent: true; height?: never; expandable?: never }
  | {
      fitContent?: false;
      /** Visible height at the default snap: "82%", "500px",
       *  "min(80%, 500px)" — any CSS length. Default "82%". */
      height?: string;
      /** Whether the sheet can be raised to full screen. Default true. */
      expandable?: boolean;
    };

type Props = CommonProps & SizingProps;

export function MobileSheet(props: Props) {
  const { theme, open, onClose, children, label, onExited } = props;
  const sizing: SheetSizing = props.fitContent
    ? { fitContent: true }
    : {
        height: props.height ?? "82%",
        expandable: props.expandable ?? true,
      };

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

  // While open the sheet owns a history entry and Esc, so Back and Esc close
  // it instead of acting on the screen under it.
  useBackLayer(open, () => onCloseRef.current());
  useEscapeKey(open, () => onCloseRef.current());

  const handleExited = useCallback(() => {
    setMounted(false);
    onExitedRef.current?.();
  }, []);

  if (!mounted) return null;
  return (
    <SheetFrame
      theme={theme}
      open={open}
      sizing={sizing}
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
  sizing,
  label,
  onCloseRef,
  onExited,
  children,
}: {
  theme: Theme;
  open: boolean;
  sizing: SheetSizing;
  label?: string;
  onCloseRef: RefObject<() => void>;
  onExited: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const ctrlRef = useRef<SheetController | null>(null);
  const scrimPressedRef = useRef(false);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const setFooter = useCallback((el: HTMLDivElement | null) => {
    footerRef.current = el;
    setFooterSlot(el);
  }, []);

  const sizingRef = useRef(sizing);
  sizingRef.current = sizing;
  const sizingKey = sizing.fitContent
    ? "fit"
    : `${sizing.height}|${sizing.expandable}`;
  // The safe-area inset is read off a probe node: cached, and re-read only
  // when the window itself changes (rotation, system bars).
  const safeTopRef = useRef(0);

  /** Size the box for its container and hand the geometry to the engine. */
  const measure = useCallback((animate: boolean) => {
    const root = rootRef.current;
    const box = boxRef.current;
    const ctrl = ctrlRef.current;
    if (!root || !box || !ctrl) return;
    if (!safeTopRef.current) safeTopRef.current = readSafeAreaInsetTop();
    ctrl.setGeometry(
      layOutSheet(root, box, safeTopRef.current, sizingRef.current),
      animate,
    );
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

  // `open` after mount: close, or come back if reopened mid-exit. Compared
  // with the previous value rather than skipped once, so StrictMode's second
  // effect run is a no-op instead of a spurious settle.
  const prevOpenRef = useRef(open);
  useLayoutEffect(() => {
    if (prevOpenRef.current === open) return;
    prevOpenRef.current = open;
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (open) ctrl.settleTo("default", 0);
    else ctrl.close();
  }, [open]);

  // New sizing while open (the update sheet switching views) animates.
  const prevSizingKeyRef = useRef(sizingKey);
  useLayoutEffect(() => {
    if (prevSizingKeyRef.current === sizingKey) return;
    prevSizingKeyRef.current = sizingKey;
    measure(true);
  }, [sizingKey, measure]);

  // The container resizing (rotation, immersive mode toggling the system
  // bars) and, for a content-sized sheet, the box following its content —
  // footer included. A soft keyboard does not appear here: measured on the
  // tablet, it shrinks only the visual viewport, and the WebView pans the
  // focused field into view without any layout change.
  useEffect(() => {
    const onWindowResize = () => {
      safeTopRef.current = readSafeAreaInsetTop();
      measure(false);
    };
    window.addEventListener("resize", onWindowResize);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure(false));
    if (rootRef.current) ro?.observe(rootRef.current);
    if (sizingKey === "fit" && boxRef.current) ro?.observe(boxRef.current);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      ro?.disconnect();
    };
  }, [sizingKey, measure]);

  const api = useMemo<SheetApi>(
    () => ({ reveal: (el) => ctrlRef.current?.reveal(el) }),
    [],
  );

  return (
    // Clipping here is load-bearing. The sheet is absolutely positioned and
    // translated, and a transformed box still contributes to its ancestor's
    // scrollable overflow: without the clip the reader root grew a scroll
    // area as tall as the sheet's off-screen tail and got scrolled to it,
    // shoving the page up as the sheet opened. `.riwaq-clip-window`
    // (global.css) upgrades `hidden` to `overflow: clip`, which also stops
    // this element from being scrolled by a scrollIntoView inside the sheet.
    // While the sheet slides away it takes no taps: a re-tap on ⋮ must reach
    // ⋮, not the departing scrim.
    <div
      ref={rootRef}
      className="riwaq-clip-window"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: Z.panel,
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* opacity is written by the engine, never by React. Only a press that
          began here closes the sheet: the click that follows a long-press's
          lift lands here too, once the sheet that press opened covers the
          spot, and must not close it. */}
      <div
        ref={scrimRef}
        data-sheet-scrim
        onPointerDown={() => {
          scrimPressedRef.current = true;
        }}
        onPointerCancel={() => {
          scrimPressedRef.current = false;
        }}
        onClick={() => {
          if (!scrimPressedRef.current) return;
          scrimPressedRef.current = false;
          onCloseRef.current();
        }}
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
            flex: sizing.fitContent ? "0 1 auto" : "1 1 0",
            minHeight: 0,
            overflowY: "auto",
            overscrollBehaviorY: "contain",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <SheetProvider api={api} footerSlot={footerSlot}>
            {children}
          </SheetProvider>
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
