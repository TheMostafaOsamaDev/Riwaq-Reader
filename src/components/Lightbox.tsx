// Image lightbox — full-viewport overlay shown when the user taps/clicks
// a chapter image. Smooth fade-in on open, fade-out on close. Click the
// backdrop, the close button, or press Esc to dismiss.
//
// Mounted at the App root so it overlays both the Library reader and the
// streaming reader without either having to wire its own copy. Triggered
// by a click handler in BookBody.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/useI18n";

interface Props {
  /** URL the lightbox displays. When null, the lightbox is unmounted. */
  src: string | null;
  /** Optional caption shown at the bottom of the viewport. */
  alt?: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: Props) {
  const { tr } = useI18n();
  // Two-stage open/close: when `src` flips from null → string we mount
  // and start invisible, then on the next frame set `entered: true` to
  // trigger the fade-in. On close, we set `entered: false`, wait for
  // the transition, then notify the parent to unmount via `onClose`.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (src) {
      // Two rAFs — one for layout settle, one for the transition to
      // actually run. Without this, browsers sometimes batch the
      // initial style and the entered style together and skip the
      // transition.
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => setEntered(true));
        // Cleanup captures r2 via closure below.
        return () => cancelAnimationFrame(r2);
      });
      return () => cancelAnimationFrame(r1);
    }
    setEntered(false);
  }, [src]);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock scroll while open — without this, mouse-wheel on the backdrop
    // would scroll the reader content underneath.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10500,
        background: "rgba(0,0,0,0.86)",
        opacity: entered ? 1 : 0,
        transition: "opacity 220ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        cursor: "zoom-out",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={tr("lightbox.closeImage")}
        style={{
          position: "absolute",
          top: 16,
          insetInlineEnd: 16,
          width: 40,
          height: 40,
          borderRadius: 20,
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}
      >
        <Icon name="close" size={18} />
      </button>
      <img
        src={src}
        alt={alt ?? ""}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        // Scale + fade together so the image grows in from 96% to 100%
        // as the overlay fades up — a small touch that makes the open
        // feel deliberate rather than instant.
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 6,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          cursor: "default",
          transform: entered ? "scale(1)" : "scale(0.96)",
          opacity: entered ? 1 : 0,
          transition:
            "transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 200ms ease",
        }}
      />
      {alt && alt.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            color: "rgba(255,255,255,0.78)",
            fontSize: 13,
            maxWidth: "70%",
            textAlign: "center",
            background: "rgba(0,0,0,0.4)",
            padding: "6px 14px",
            borderRadius: 999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {alt}
        </div>
      )}
    </div>
  );
  return createPortal(node, document.body);
}
