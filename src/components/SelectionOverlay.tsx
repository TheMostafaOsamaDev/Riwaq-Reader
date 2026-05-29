// Translucent boxes drawn over a custom selection's per-line client
// rects. Pointer-transparent so taps fall through to BookBody for
// outside-tap dismissal handled by MobileReader's click listener.

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
        zIndex: 8500, // below SelectionPopover (9000), above content
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
            background: "rgba(120, 180, 220, 0.32)",
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}
