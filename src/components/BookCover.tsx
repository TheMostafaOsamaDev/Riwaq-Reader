import { useState } from "react";
import { ACCENT, FONT_SERIF_DISPLAY, FONT_READING_SANS, isArabicTitle } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  title: string;
  author: string;
  palette: readonly [string, string, string];
  size?: "sm" | "md" | "lg";
  /**
   * Webview-loadable cover URL (e.g. from `convertFileSrc`). When present,
   * the image replaces the palette/text spine. If it fails to load, we fall
   * back to the palette rendering automatically.
   */
  src?: string | null;
  /**
   * Fill the parent's width (using the size's aspect ratio for height) instead
   * of rendering at the fixed pixel dimensions. Used by the mobile shelf grid,
   * where 3 fixed-width sm covers overflow narrower phones.
   */
  fluid?: boolean;
  /** Small corner pill (e.g. "PDF", "DOCX") marking the book's format. */
  badge?: string | null;
}

export const BOOK_COVER_DIMS = {
  sm: { w: 110, h: 164 },
  md: { w: 140, h: 208 },
  lg: { w: 200, h: 296 },
} as const;

export function BookCover({
  title,
  author,
  palette,
  size = "md",
  src,
  fluid = false,
  badge,
}: Props) {
  const { tr } = useI18n();
  const badgeEl = badge ? (
    <span
      style={{
        position: "absolute",
        bottom: 6,
        insetInlineStart: 6,
        background: ACCENT,
        color: "#fff",
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 5px",
        borderRadius: 4,
        fontFamily: FONT_READING_SANS,
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
        pointerEvents: "none",
      }}
    >
      {badge}
    </span>
  ) : null;
  const { w, h } = BOOK_COVER_DIMS[size];
  const [p1, p2, p3] = palette;
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;
  // Display-time fallback for a blank `Book.title` — a book/novel with no
  // detected title persists as "" (see common.untitled's own doc comment)
  // so this leaf renders the localized placeholder instead of an empty
  // spine.
  const displayTitle = title || tr("common.untitled");

  const shellStyle = {
    ...(fluid
      ? { width: "100%", aspectRatio: `${w} / ${h}` }
      : { width: w, height: h, flexShrink: 0 }),
    borderRadius: 6,
    position: "relative" as const,
    boxShadow:
      "0 1px 2px rgba(0,0,0,0.1), 0 6px 18px rgba(0,0,0,0.15), inset 1px 0 0 rgba(255,255,255,0.08), inset -1px 0 0 rgba(0,0,0,0.2)",
    overflow: "hidden" as const,
  };

  if (showImage) {
    return (
      <div style={{ ...shellStyle, background: p1 }}>
        <img
          src={src!}
          alt={`${displayTitle} — cover`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
        {/* Thin spine shadow, kept for depth — covers don't paint it themselves. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.3) 0%, transparent 100%)",
            pointerEvents: "none",
          }}
        />
        {badgeEl}
      </div>
    );
  }

  const pad =
    size === "lg" ? "18px 16px" : size === "sm" ? "10px 9px" : "14px 12px";
  const titleSize = size === "lg" ? 22 : size === "sm" ? 13 : 16;
  const authorSize = size === "lg" ? 10 : size === "sm" ? 8 : 9;

  return (
    <div
      style={{
        ...shellStyle,
        background: `linear-gradient(155deg, ${p1} 0%, ${p1} 55%, ${p2} 100%)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: pad,
        fontFamily: FONT_SERIF_DISPLAY,
        color: p3,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.3) 0%, transparent 100%)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
        <div style={{ width: 14, height: 1, background: p3, opacity: 0.5 }} />
        <div
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: p3,
            opacity: 0.5,
          }}
        />
        <div style={{ width: 14, height: 1, background: p3, opacity: 0.5 }} />
      </div>
      <div style={{ marginLeft: 8, marginRight: 4, minWidth: 0 }}>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 500,
            fontStyle: "italic",
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            textWrap: "balance",
            display: "-webkit-box",
            WebkitLineClamp: size === "sm" ? 3 : 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {displayTitle}
        </div>
        <div
          style={{
            marginTop: size === "lg" ? 10 : 6,
            fontSize: authorSize,
            // Extra letter-spacing + uppercasing are a Latin-typography
            // convention that breaks Arabic glyph joining/ligatures. The
            // author line can be Arabic either via the book's own (content)
            // author name or the UI-locale "Unknown author" fallback, so
            // check the actual rendered text's script rather than the UI
            // locale — same detector BookCover's title uses (titleFontFor/
            // isArabicTitle below).
            letterSpacing: isArabicTitle(author || tr("common.unknownAuthor"))
              ? "normal"
              : "0.18em",
            textTransform: isArabicTitle(author || tr("common.unknownAuthor"))
              ? "none"
              : "uppercase",
            fontFamily: FONT_READING_SANS,
            fontWeight: 600,
            opacity: 0.7,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {author || tr("common.unknownAuthor")}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
        <div style={{ width: 14, height: 1, background: p3, opacity: 0.5 }} />
        <div
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: p3,
            opacity: 0.5,
          }}
        />
        <div style={{ width: 14, height: 1, background: p3, opacity: 0.5 }} />
      </div>
      {badgeEl}
    </div>
  );
}
