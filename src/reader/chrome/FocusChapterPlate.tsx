// The chapter's name in focus mode, and the fades that let it have no bar.
//
// Focus mode takes the top bar away, and with it the only thing on screen that
// said which chapter you were in. The band the bar had occupied stayed in the
// layout as blank paper — permanently blank in the paginated modes, where the
// page is fitted to the padded box and nothing ever scrolls through it. The
// reader lost the chapter name AND kept paying for it in screen height.
//
// So the band carries the name instead of nothing. Deliberately NOT a second
// bar: no fill, no hairline, nothing that cuts the page in two — a centred,
// tracked line with a short rule under it, sitting on a page-to-transparent
// fade that the body text dissolves into as it scrolls up. Focus mode gets a
// header with no chrome in it.
//
// It is the sibling of the end-of-chapter marker (see ChapterEnd) on purpose:
// same muted ink, same tracked-sans register, same short rules. One book, one
// voice at the head and the foot of a chapter.

import type { CSSProperties } from "react";
import { EASE, MOTION } from "../../styles/motion";
import {
  inkAlpha,
  isArabicTitle,
  titleFontFor,
  withAlpha,
  type Theme,
  Z,
} from "../../styles/tokens";
import {
  FOCUS_FADE_BOTTOM,
  FOCUS_FADE_SOLID,
  FOCUS_FADE_TOP,
} from "./focusInsets";

/** Air above the chapter name, before the safe-area inset is added. */
const PLATE_AIR_TOP = 26;
/** Fixed line box for the name, so the plate's height never depends on which
 *  script the title happens to be in — the insets in focusInsets are constants
 *  and cannot follow a font metric. */
const PLATE_LINE = 16;
/** Gap between the name and its rule. */
const PLATE_GAP = 9;
/** Width of the rule under the name. It fades out at both ends rather than
 *  stopping dead, which is what keeps it reading as a mark under the title
 *  instead of a 36px fragment of a border. */
const PLATE_RULE_W = 36;

interface PlateProps {
  theme: Theme;
  /** The page colour the fade has to resolve to — `readingSurfaces().page`,
   *  not `theme.bg`: three of the four themes set `paper` equal to `bg` but
   *  the reading surface derives a tonal step off it, and a fade to the wrong
   *  one of the two leaves a visible seam across the top of the page. */
  surface: string;
  title: string;
  /** True while focus mode is dressing the page at all. Governs the FADE,
   *  which is page furniture: it is what lets the text dissolve at the top
   *  edge instead of being cut by one, and it stays up even where the name
   *  does not. */
  shown: boolean;
  /** True while the running head itself belongs on screen. Narrower than
   *  `shown`, and false in the two cases where this name would be the second
   *  copy of itself: the real top bar is revealed under the pointer, or the
   *  chapter's own display title is still in view. */
  nameShown: boolean;
  reducedMotion: boolean;
}

/** A page-coloured fade, solid for the first `FOCUS_FADE_SOLID` of its height
 *  and clear by the end. `withAlpha(surface, 0)` rather than the `transparent`
 *  keyword — see the note on `withAlpha`. */
function fadeTo(edge: "bottom" | "top", surface: string): string {
  return `linear-gradient(to ${edge}, ${surface} 0%, ${surface} ${FOCUS_FADE_SOLID * 100}%, ${withAlpha(surface, 0)} 100%)`;
}

/** How the plate and the bottom fade come and go. Opacity plus a short lift,
 *  so entering focus mode reads as the name settling onto the page rather than
 *  as a bar arriving. Neither element carries `backdrop-filter`, so unlike the
 *  chrome bars these are free to animate opacity. */
function reveal(shown: boolean, reducedMotion: boolean): CSSProperties {
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? "translateY(0)" : "translateY(-4px)",
    // Leaves the accessibility tree and the hit-testing entirely once faded
    // out, so the title is never announced twice while the top bar is up.
    visibility: shown ? "visible" : "hidden",
    transition: reducedMotion
      ? "none"
      : `opacity ${MOTION.med}ms ${EASE.enter}, transform ${MOTION.med}ms ${EASE.enter}, visibility 0s linear ${shown ? "0s" : `${MOTION.med}ms`}`,
  };
}

export function FocusChapterPlate({
  theme,
  surface,
  title,
  shown,
  nameShown,
  reducedMotion,
}: PlateProps) {
  // Arabic is cursive: tracking prises the joins apart and there is no case to
  // upper. Same split the first-run focus hint already makes, keyed off the
  // TITLE's own script rather than the UI language — an Arabic chapter name in
  // an English shell still has to be set as Arabic.
  const arabic = isArabicTitle(title);
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        // Rendered inside the reading column, so it centres on the text and
        // not on the window — a docked Contents panel narrows the column and
        // the name follows it across with no inset arithmetic of its own.
        height: `calc(${FOCUS_FADE_TOP}px + env(safe-area-inset-top, 0px))`,
        // Under the chrome bars at `Z.focusBar`, so a bar revealed at the edge
        // covers the plate rather than interleaving with it.
        zIndex: Z.focusPlate,
        // The plate lies over the page. Claiming the pointer here would break
        // drag-selecting the first lines of a chapter, and would also hide the
        // page from the root's edge tracking, which reads `e.target` to tell
        // the page apart from a docked panel.
        pointerEvents: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        ...reveal(shown, reducedMotion),
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: fadeTo("bottom", surface),
        }}
      />
      {/* The running head, on its own visibility. It comes and goes inside a
          fade that stays, so the top edge of the page never loses its
          dissolve just because the name has stepped back.
          `alignSelf: stretch` because the plate centres its children, which
          would otherwise shrink-wrap this group — and the title's percentage
          max-width would then resolve against that shrink-to-fit width
          instead of the column's, truncating names that fit perfectly well. */}
      <div
        style={{
          position: "relative",
          alignSelf: "stretch",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          ...reveal(nameShown, reducedMotion),
        }}
      >
        <div
          title={title}
          style={{
            marginTop: `calc(${PLATE_AIR_TOP}px + env(safe-area-inset-top, 0px))`,
            maxWidth: "min(76%, 560px)",
            // The name is book content, so it keeps the display stack the top
            // bar's title uses — just in the marker's register.
            fontFamily: titleFontFor(title),
            fontSize: arabic ? 12.5 : 11,
            lineHeight: `${PLATE_LINE}px`,
            fontWeight: arabic ? 500 : 600,
            letterSpacing: arabic ? "normal" : "0.2em",
            textTransform: arabic ? "none" : "uppercase",
            color: theme.muted,
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            // Tracking adds space AFTER the last glyph too, which pulls a
            // centred line visibly off-centre. Half of it back closes the gap.
            ...(arabic ? null : { textIndent: "0.2em" }),
          }}
        >
          {title}
        </div>
        <div
          aria-hidden
          style={{
            marginTop: PLATE_GAP,
            width: PLATE_RULE_W,
            height: 1,
            background: `linear-gradient(to right, ${withAlpha(theme.ink, 0)}, ${inkAlpha(theme, 0.3)}, ${withAlpha(theme.ink, 0)})`,
          }}
        />
      </div>
    </div>
  );
}

interface FadeProps {
  surface: string;
  shown: boolean;
  reducedMotion: boolean;
}

/** The bottom half of the same idea: the last lines dissolve into the page
 *  instead of being cut off at the window's edge, which is what lets the
 *  bottom inset come down to the fade's own height. */
export function FocusBottomFade({ surface, shown, reducedMotion }: FadeProps) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: `calc(${FOCUS_FADE_BOTTOM}px + env(safe-area-inset-bottom, 0px))`,
        zIndex: Z.focusPlate,
        pointerEvents: "none",
        background: fadeTo("top", surface),
        ...reveal(shown, reducedMotion),
        // No lift on this one: it is anchored to the bottom edge, so a
        // translate would show a sliver of unfaded text under it.
        transform: "none",
      }}
    />
  );
}
