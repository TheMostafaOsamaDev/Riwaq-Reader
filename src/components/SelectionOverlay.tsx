// Translucent boxes rendered over the rects of the just-captured
// selection. After MobileReader clears the native window selection
// (to suppress Samsung One UI's floating toolbar), this overlay is
// the visible cue showing the user which text they're about to
// highlight. Boxes are pointer-transparent so taps fall through to
// the underlying BookBody for outside-tap dismissal.

interface Props {
  rects: DOMRect[];
}

export function SelectionOverlay({ rects }: Props) {
  if (rects.length === 0) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 8500, // below SelectionPopover (9000), above book content
      }}
    >
      {rects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            background: "rgba(120, 180, 220, 0.28)",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}
