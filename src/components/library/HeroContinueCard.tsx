// The "continue reading" card at the top of the library, in the four styles
// Settings ▸ Appearance offers (Tweaks.heroStyle):
//
//   ambient   the book's cover, blurred, tints a dark card (the shared Hero
//             shell, same as the book-detail page)
//   refined   a quiet layout on the page itself
//   bookmark  leads with the chapter you stopped at, over a chapter ruler
//   stack     a compact card plus the other books you have open
//
// Every style keeps ONE primary action (resume) and puts the rest — status,
// edit, remove — behind a "more" button that opens the same context menu as
// right-clicking / long-pressing a shelf card. The old card set "Remove from
// library" beside "Resume reading", one slip from deleting the book.

import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { BookCover } from "../BookCover";
import { Button } from "../Button";
import { Hero } from "../Hero";
import { Icon } from "../Icon";
import { useLongPress } from "../../hooks/useLongPress";
import type { BookIndexEntry } from "../../store/library";
import { paletteForId } from "../../store/palette";
import { ACCENT, titleFontFor, type Theme } from "../../styles/tokens";
import type { HeroStyle } from "../../types/reader";
import { formatNum } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import { relTime } from "./relTime";
import {
  alsoReading,
  chapterTicks,
  percentRead,
  readingPosition,
  type ReadingPosition,
} from "./heroModel";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  variant: HeroStyle;
  book: BookIndexEntry;
  /** The whole visible list — the "stack" style picks its other open books
   *  from it. */
  books: BookIndexEntry[];
  covers: Record<string, string>;
  onOpen: (id: string) => void;
  /** Open a book's context menu at a viewport point. */
  onMenu: (id: string, x: number, y: number) => void;
}

/** Light-on-dark ink for the ambient card. Fixed, not from the theme: the
 *  scrim under it is dark in every theme (see Hero). */
const ON_IMAGE = "#ffffff";
const ON_IMAGE_MUTED = "rgba(255,255,255,0.82)";
const ON_IMAGE_TRACK = "rgba(255,255,255,0.24)";

export function HeroContinueCard(props: Props) {
  const { book, books, layout } = props;
  const pos = readingPosition(book);
  // Styles that are built around something the book may not have fall back
  // to "refined" rather than drawing an empty frame: the ruler needs a
  // chapter count, the stack needs another open book.
  const also =
    props.variant === "stack"
      ? alsoReading(books, book.id, layout === "mobile" ? 2 : 3)
      : [];
  let variant = props.variant;
  if (variant === "bookmark" && !pos) variant = "refined";
  if (variant === "stack" && also.length === 0) variant = "refined";

  const mobile = layout === "mobile";
  const card =
    variant === "ambient" ? (
      <AmbientCard {...props} pos={pos} />
    ) : variant === "bookmark" && pos ? (
      <BookmarkCard {...props} pos={pos} />
    ) : variant === "stack" ? (
      <StackCard {...props} pos={pos} also={also} />
    ) : (
      <RefinedCard {...props} pos={pos} />
    );
  if (mobile) {
    // The stack's other books sit OUTSIDE the tap target: each row is its own
    // button with its own long press, and nesting them would open two menus.
    return variant === "stack" ? (
      <div style={{ marginBottom: 28 }}>
        <MobileTapTarget {...props}>{card}</MobileTapTarget>
        <AlsoList {...props} also={also} />
      </div>
    ) : (
      <div style={{ marginBottom: 28 }}>
        <MobileTapTarget {...props}>{card}</MobileTapTarget>
      </div>
    );
  }
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(book.id, e.clientX, e.clientY);
      }}
      style={{ marginBottom: 50 }}
    >
      {card}
    </div>
  );
}

/** On a phone the whole card opens the book, and a long press opens its
 *  menu, as it always has. The Resume button inside is the keyboard and
 *  screen-reader path, so the wrapper itself is not announced as a button. */
function MobileTapTarget({
  book,
  onOpen,
  onMenu,
  children,
}: Props & { children: ReactNode }) {
  const longPress = useLongPress((x, y) => onMenu(book.id, x, y));
  return (
    <div
      onClick={() => {
        if (longPress.consumeLongPress()) return;
        onOpen(book.id);
      }}
      {...longPress.bind}
      style={{
        cursor: "pointer",
        // Suppress the long-press text selection / callout so the menu opens
        // cleanly without a stray selection box.
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {children}
    </div>
  );
}

// ── shared pieces ───────────────────────────────────────────────────────────

function useHeroText(book: BookIndexEntry) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const num = (n: number) => formatNum(n, locale);
  const displayTitle = book.title || tr("common.untitled");
  const eyebrow = (color: string, size = 11): CSSProperties => ({
    fontSize: size,
    fontWeight: 600,
    color,
    letterSpacing: isAr ? "normal" : "0.12em",
    textTransform: isAr ? "none" : "uppercase",
  });
  const rel = relTime(book.lastReadAt ?? book.addedAt, tr);
  const lead = book.lastReadAt
    ? tr("library.continueReading")
    : tr("library.startReading");
  // The phone cards pair the label with the time; the long form wraps there.
  const leadShort = book.lastReadAt
    ? tr("library.continue")
    : tr("library.startReading");
  return { tr, isAr, num, displayTitle, eyebrow, rel, lead, leadShort };
}

function positionLabel(
  pos: ReadingPosition,
  tr: ReturnType<typeof useI18n>["tr"],
  num: (n: number) => string,
) {
  return tr(pos.unit === "page" ? "library.pageOf" : "library.chapterOf", {
    n: num(pos.n),
    total: num(pos.total),
  });
}

function Title({
  text,
  size,
  color,
  clamp = 2,
}: {
  text: string;
  size: number;
  color: string;
  clamp?: number;
}) {
  return (
    <h2
      title={text}
      style={{
        fontFamily: titleFontFor(text),
        fontWeight: 400,
        fontSize: size,
        // 1.45, not tighter: at display sizes the dots under ج and ي clip
        // below ~1.4.
        lineHeight: 1.45,
        margin: 0,
        letterSpacing: "-0.02em",
        color,
        display: "-webkit-box",
        WebkitLineClamp: clamp,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        textWrap: "balance",
      }}
    >
      {text}
    </h2>
  );
}

/** "Chapter 5 of 114 ······ 4%" over a bar. */
function Progress({
  book,
  pos,
  ink,
  track,
  height,
  fontSize,
}: {
  book: BookIndexEntry;
  pos: ReadingPosition | null;
  ink: string;
  track: string;
  height: number;
  fontSize: number;
}) {
  const { tr, num } = useHeroText(book);
  const pct = percentRead(book.progress);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          fontSize,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: ink, fontWeight: 500 }}>
          {pos ? positionLabel(pos, tr, num) : null}
        </span>
        <span style={{ color: ink, fontWeight: 600 }}>{num(pct)}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={tr("library.percentRead", { n: num(pct) })}
        style={{
          height,
          borderRadius: height / 2,
          background: track,
          display: "flex",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            // A dot at 1%, not an invisible sliver.
            minWidth: height,
            height: "100%",
            borderRadius: height / 2,
            background: ink,
          }}
        />
      </div>
    </div>
  );
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function ResumeButton({
  theme,
  book,
  label,
  onOpen,
  onImage,
  fullWidth,
  pill,
}: {
  theme: Theme;
  book: BookIndexEntry;
  label: string;
  onOpen: (id: string) => void;
  onImage?: boolean;
  fullWidth?: boolean;
  pill?: boolean;
}) {
  return (
    <Button
      theme={theme}
      variant="primary"
      size="lg"
      surface={onImage ? "onImage" : "default"}
      shape={pill ? "pill" : "rounded"}
      fullWidth={fullWidth}
      leadingIcon={<Icon name="play" size={13} fill="currentColor" />}
      onClick={(e) => {
        stop(e);
        onOpen(book.id);
      }}
      style={{ minHeight: 44 }}
    >
      {label}
    </Button>
  );
}

function MoreButton({
  theme,
  book,
  onMenu,
  onImage,
  quiet,
}: {
  theme: Theme;
  book: BookIndexEntry;
  onMenu: (id: string, x: number, y: number) => void;
  onImage?: boolean;
  /** Borderless — for the corner of a phone card. */
  quiet?: boolean;
}) {
  const { tr } = useI18n();
  const label = tr("library.moreActions");
  return (
    <Button
      theme={theme}
      iconOnly
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      variant={quiet ? "ghost" : onImage ? "secondary" : "outline"}
      surface={onImage ? "onImage" : "default"}
      shape={onImage || quiet ? "pill" : "rounded"}
      onClick={(e) => {
        stop(e);
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(book.id, r.left, r.bottom + 4);
      }}
      style={quiet && !onImage ? { color: theme.muted } : undefined}
    >
      <Icon name="more" size={18} />
    </Button>
  );
}

/** BookCover at an arbitrary width — `fluid` fills this wrapper. */
function Cover({
  book,
  covers,
  width,
  shadow,
}: {
  book: BookIndexEntry;
  covers: Record<string, string>;
  width: number;
  shadow?: boolean;
}) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        borderRadius: 6,
        boxShadow: shadow
          ? "0 2px 4px rgba(0,0,0,0.12), 0 18px 40px -8px rgba(0,0,0,0.35)"
          : undefined,
      }}
    >
      <BookCover
        title={book.title}
        author={book.author}
        palette={paletteForId(book.id)}
        size={width >= 160 ? "lg" : width >= 120 ? "md" : "sm"}
        src={covers[book.id]}
        fluid
      />
    </div>
  );
}

type CardProps = Props & { pos: ReadingPosition | null };

// ── refined ─────────────────────────────────────────────────────────────────

/** A desktop card's cover + details row. It wraps: in a narrow window
 *  (down to the 720px window minimum) the details drop under the cover
 *  instead of being squeezed until the actions are clipped off the edge. */
function desktopRow(gap: number): CSSProperties {
  return { display: "flex", flexWrap: "wrap", columnGap: gap, rowGap: 24 };
}

/** The details column beside the cover. The basis is the narrowest it reads
 *  well at; below it, `desktopRow` wraps it onto its own line. */
const DESKTOP_DETAILS: CSSProperties = { flex: "1 1 300px", minWidth: 0 };

const ACTIONS_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

function RefinedCard({
  theme,
  layout,
  book,
  covers,
  onOpen,
  onMenu,
  pos,
}: CardProps) {
  const { tr, displayTitle, eyebrow, rel, lead } = useHeroText(book);
  const resume = book.lastReadAt
    ? tr("library.resumeReading")
    : tr("library.startReading");
  const author = book.author || tr("common.unknownAuthor");

  if (layout === "mobile") {
    return (
      <div
        style={{
          position: "relative",
          padding: 14,
          borderRadius: 16,
          background: theme.chrome,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Cover book={book} covers={covers} width={92} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingTop: 4,
              paddingInlineEnd: 36,
            }}
          >
            <div style={eyebrow(theme.muted)}>{lead}</div>
            <Title text={displayTitle} size={19} color={theme.ink} />
            <div style={{ fontSize: 12.5, color: theme.muted }}>{author}</div>
            <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
              {rel}
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", top: 4, insetInlineEnd: 4 }}>
          <MoreButton theme={theme} book={book} onMenu={onMenu} quiet />
        </div>
        <Progress
          book={book}
          pos={pos}
          ink={theme.ink}
          track={theme.rule}
          height={5}
          fontSize={12.5}
        />
        <ResumeButton
          theme={theme}
          book={book}
          label={resume}
          onOpen={onOpen}
          fullWidth
        />
      </div>
    );
  }

  return (
    <div style={desktopRow(48)}>
      <Cover book={book} covers={covers} width={200} shadow />
      <div
        style={{
          ...DESKTOP_DETAILS,
          maxWidth: 620,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={eyebrow(theme.muted)}>{lead}</div>
          <Title text={displayTitle} size={44} color={theme.ink} />
          <div style={{ fontSize: 14, color: theme.muted }}>{author}</div>
        </div>
        <div
          style={{
            maxWidth: 520,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Progress
            book={book}
            pos={pos}
            ink={theme.ink}
            track={theme.rule}
            height={6}
            fontSize={14}
          />
          <div style={{ fontSize: 12, color: theme.muted }}>
            {tr("library.lastRead", { rel })}
          </div>
        </div>
        <div style={ACTIONS_ROW}>
          <ResumeButton
            theme={theme}
            book={book}
            label={resume}
            onOpen={onOpen}
          />
          <MoreButton theme={theme} book={book} onMenu={onMenu} />
        </div>
      </div>
    </div>
  );
}

// ── ambient ─────────────────────────────────────────────────────────────────

function AmbientCard({
  theme,
  layout,
  book,
  covers,
  onOpen,
  onMenu,
  pos,
}: CardProps) {
  const { tr, displayTitle, eyebrow, rel, lead, leadShort } = useHeroText(book);
  const resume = book.lastReadAt
    ? tr("library.resumeReading")
    : tr("library.startReading");
  const author = book.author || tr("common.unknownAuthor");
  const mobile = layout === "mobile";
  // A palette-generated cover has no image to blur; its own mid tone seeds
  // the Hero's fallback glow so the card still takes the book's colour.
  const accent = paletteForId(book.id)[1];

  if (mobile) {
    return (
      <Hero
        layout="mobile"
        backdropUrl={covers[book.id]}
        accent={accent}
        minHeight={0}
        style={{ margin: 0, borderRadius: 18 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            color: ON_IMAGE,
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Cover book={book} covers={covers} width={96} />
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                paddingTop: 2,
              }}
            >
              <div style={eyebrow(ON_IMAGE_MUTED)}>
                {leadShort} · {rel}
              </div>
              <Title text={displayTitle} size={20} color={ON_IMAGE} />
              <div style={{ fontSize: 12.5, color: ON_IMAGE_MUTED }}>
                {author}
              </div>
            </div>
            <div style={{ marginTop: -10, marginInlineEnd: -8 }}>
              <MoreButton
                theme={theme}
                book={book}
                onMenu={onMenu}
                onImage
                quiet
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Progress
                book={book}
                pos={pos}
                ink={ON_IMAGE}
                track={ON_IMAGE_TRACK}
                height={4}
                fontSize={12.5}
              />
            </div>
            <ResumeButton
              theme={theme}
              book={book}
              label={tr("library.resume")}
              onOpen={onOpen}
              onImage
              pill
            />
          </div>
        </div>
      </Hero>
    );
  }

  return (
    <Hero
      layout="desktop"
      backdropUrl={covers[book.id]}
      accent={accent}
      minHeight={0}
      style={{ margin: 0, borderRadius: 20 }}
    >
      <div
        style={{
          ...desktopRow(44),
          alignItems: "flex-end",
          color: ON_IMAGE,
        }}
      >
        <Cover book={book} covers={covers} width={188} shadow />
        <div
          style={{
            ...DESKTOP_DETAILS,
            maxWidth: 640,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={eyebrow(ON_IMAGE_MUTED)}>
              {lead} · {rel}
            </div>
            <Title text={displayTitle} size={44} color={ON_IMAGE} />
            <div style={{ fontSize: 14, color: ON_IMAGE_MUTED }}>{author}</div>
          </div>
          <div style={{ maxWidth: 480 }}>
            <Progress
              book={book}
              pos={pos}
              ink={ON_IMAGE}
              track={ON_IMAGE_TRACK}
              height={5}
              fontSize={13.5}
            />
          </div>
          <div style={ACTIONS_ROW}>
            <ResumeButton
              theme={theme}
              book={book}
              label={resume}
              onOpen={onOpen}
              onImage
              pill
            />
            <MoreButton theme={theme} book={book} onMenu={onMenu} onImage />
          </div>
        </div>
      </div>
    </Hero>
  );
}

// ── bookmark ────────────────────────────────────────────────────────────────

function Ruler({
  theme,
  pos,
  max,
  height,
  gap,
}: {
  theme: Theme;
  pos: ReadingPosition;
  max: number;
  height: number;
  gap: number;
}) {
  const { tr, locale } = useI18n();
  const num = (n: number) => formatNum(n, locale);
  const ticks = chapterTicks(pos, max);
  const short = Math.round(height * 0.6);
  return (
    <div
      role="img"
      aria-label={positionLabel(pos, tr, num)}
      style={{ display: "flex", alignItems: "flex-end", gap, height }}
    >
      {ticks.map((t, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            height: t.state === "current" ? height : short,
            borderRadius: 1,
            background:
              t.state === "read"
                ? theme.ink
                : t.state === "current"
                  ? ACCENT
                  : theme.ruleStrong,
          }}
        />
      ))}
    </div>
  );
}

/** The ribbon hanging out of the bottom of the cover. */
function Ribbon({ style }: { style: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        background: ACCENT,
        clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)",
        ...style,
      }}
    />
  );
}

function BookmarkCard({
  theme,
  layout,
  book,
  covers,
  onOpen,
  onMenu,
  pos,
}: CardProps & { pos: ReadingPosition }) {
  const { tr, num, displayTitle, eyebrow, rel } = useHeroText(book);
  const big = tr(
    pos.unit === "page" ? "library.pageBig" : "library.chapterBig",
    {
      n: num(pos.n),
    },
  );
  const of = tr("library.ofTotal", { total: num(pos.total) });
  const resume = tr(
    pos.unit === "page" ? "library.resumePage" : "library.resumeChapter",
    { n: num(pos.n) },
  );
  const author = book.author || tr("common.unknownAuthor");
  const meta = `${tr("library.percentRead", { n: num(percentRead(book.progress)) })} · ${tr("library.lastRead", { rel })}`;

  if (layout === "mobile") {
    return (
      <div
        style={{
          position: "relative",
          padding: 18,
          borderRadius: 16,
          background: theme.chrome,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "hidden",
        }}
      >
        <Ribbon style={{ top: 0, insetInlineEnd: 64, width: 14, height: 40 }} />
        <div>
          <div style={eyebrow(theme.muted)}>{tr("library.pickUp")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontSize: 36,
                fontWeight: 300,
                letterSpacing: "-0.03em",
                lineHeight: 1.3,
                color: theme.ink,
              }}
            >
              {big}
            </span>
            <span style={{ fontSize: 16, fontWeight: 300, color: theme.muted }}>
              {of}
            </span>
          </div>
        </div>
        <div style={{ position: "absolute", top: 4, insetInlineEnd: 4 }}>
          <MoreButton theme={theme} book={book} onMenu={onMenu} quiet />
        </div>
        <Ruler theme={theme} pos={pos} max={60} height={24} gap={2} />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Cover book={book} covers={covers} width={52} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Title text={displayTitle} size={16} color={theme.ink} clamp={1} />
            <div style={{ fontSize: 12.5, color: theme.muted }}>{author}</div>
            <div
              style={{
                fontSize: 12,
                color: theme.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {meta}
            </div>
          </div>
        </div>
        <ResumeButton
          theme={theme}
          book={book}
          label={resume}
          onOpen={onOpen}
          fullWidth
        />
      </div>
    );
  }

  return (
    <div style={desktopRow(52)}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Ribbon
          style={{ insetInlineStart: 150, top: 240, width: 18, height: 92 }}
        />
        <div style={{ position: "relative" }}>
          <Cover book={book} covers={covers} width={200} shadow />
        </div>
      </div>
      <div
        style={{
          ...DESKTOP_DETAILS,
          maxWidth: 660,
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={eyebrow(theme.muted)}>{tr("library.pickUp")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                fontSize: 56,
                fontWeight: 300,
                letterSpacing: "-0.03em",
                lineHeight: 1.3,
                color: theme.ink,
              }}
            >
              {big}
            </span>
            <span style={{ fontSize: 22, fontWeight: 300, color: theme.muted }}>
              {of}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <Title
                text={displayTitle}
                size={22}
                color={theme.ink}
                clamp={1}
              />
            </div>
            <div
              style={{ fontSize: 13, color: theme.muted, whiteSpace: "nowrap" }}
            >
              {author}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Ruler theme={theme} pos={pos} max={120} height={30} gap={2} />
          <div
            style={{
              fontSize: 12,
              color: theme.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {meta}
          </div>
        </div>
        <div style={ACTIONS_ROW}>
          <ResumeButton
            theme={theme}
            book={book}
            label={resume}
            onOpen={onOpen}
          />
          <MoreButton theme={theme} book={book} onMenu={onMenu} />
        </div>
      </div>
    </div>
  );
}

// ── stack ───────────────────────────────────────────────────────────────────

function AlsoRow({
  theme,
  book,
  covers,
  onOpen,
  onMenu,
  mobile,
}: {
  theme: Theme;
  book: BookIndexEntry;
  covers: Record<string, string>;
  onOpen: (id: string) => void;
  onMenu: (id: string, x: number, y: number) => void;
  mobile: boolean;
}) {
  const { tr, num } = useHeroText(book);
  const [hover, setHover] = useState(false);
  const longPress = useLongPress((x, y) => onMenu(book.id, x, y));
  const title = book.title || tr("common.untitled");
  const pct = percentRead(book.progress);
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        if (longPress.consumeLongPress()) return;
        onOpen(book.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(book.id, e.clientX, e.clientY);
      }}
      {...(mobile ? longPress.bind : {})}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: mobile ? 12 : 14,
        width: "100%",
        minHeight: mobile ? 68 : 80,
        padding: mobile ? "8px 0" : 10,
        border: "none",
        borderBottom: mobile ? `0.5px solid ${theme.rule}` : "none",
        borderRadius: mobile ? 0 : 10,
        background: hover && !mobile ? theme.hover : "transparent",
        color: theme.ink,
        textAlign: "start",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 120ms ease",
      }}
    >
      <Cover book={book} covers={covers} width={mobile ? 36 : 42} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: mobile ? 5 : 3,
        }}
      >
        <span
          style={{
            fontFamily: titleFontFor(title),
            fontSize: 14.5,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        {!mobile && (
          <span
            style={{
              fontSize: 12,
              color: theme.muted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {book.author || tr("common.unknownAuthor")}
          </span>
        )}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: mobile ? 0 : 4,
          }}
        >
          <span
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: theme.rule,
              display: "flex",
            }}
          >
            <span
              style={{
                width: `${pct}%`,
                minWidth: 3,
                height: "100%",
                borderRadius: 2,
                background: theme.ink,
              }}
            />
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: theme.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {num(pct)}%
          </span>
        </span>
      </span>
      {mobile && (
        <Icon
          name="chevronR"
          size={16}
          className="rtl-flip-x"
          style={{ color: theme.muted, flexShrink: 0 }}
        />
      )}
    </button>
  );
}

/** The phone's "Also reading" list, under the stack's main card. */
function AlsoList({
  theme,
  covers,
  onOpen,
  onMenu,
  also,
}: Props & { also: BookIndexEntry[] }) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: theme.muted,
          letterSpacing: isAr ? "normal" : "0.12em",
          textTransform: isAr ? "none" : "uppercase",
          marginBottom: 4,
        }}
      >
        {tr("library.alsoReading")}
      </div>
      {also.map((b) => (
        <AlsoRow
          key={b.id}
          theme={theme}
          book={b}
          covers={covers}
          onOpen={onOpen}
          onMenu={onMenu}
          mobile
        />
      ))}
    </div>
  );
}

function StackCard({
  theme,
  layout,
  book,
  covers,
  onOpen,
  onMenu,
  pos,
  also,
}: CardProps & { also: BookIndexEntry[] }) {
  const { tr, displayTitle, eyebrow, rel, lead, leadShort } = useHeroText(book);
  const author = book.author || tr("common.unknownAuthor");
  const mobile = layout === "mobile";
  const rows = also.map((b) => (
    <AlsoRow
      key={b.id}
      theme={theme}
      book={b}
      covers={covers}
      onOpen={onOpen}
      onMenu={onMenu}
      mobile={mobile}
    />
  ));

  if (mobile) {
    return (
      <div
        style={{
          position: "relative",
          padding: 14,
          borderRadius: 16,
          background: theme.chrome,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Cover book={book} covers={covers} width={84} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingTop: 4,
              paddingInlineEnd: 30,
            }}
          >
            <div style={eyebrow(theme.muted)}>
              {leadShort} · {rel}
            </div>
            <Title text={displayTitle} size={18} color={theme.ink} />
            <div style={{ fontSize: 12.5, color: theme.muted }}>{author}</div>
          </div>
        </div>
        <div style={{ position: "absolute", top: 4, insetInlineEnd: 4 }}>
          <MoreButton theme={theme} book={book} onMenu={onMenu} quiet />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Progress
              book={book}
              pos={pos}
              ink={theme.ink}
              track={theme.rule}
              height={4}
              fontSize={12.5}
            />
          </div>
          <ResumeButton
            theme={theme}
            book={book}
            label={tr("library.resume")}
            onOpen={onOpen}
            pill
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
      <div
        style={{
          flex: "1.6 1 420px",
          padding: 28,
          borderRadius: 16,
          background: theme.chrome,
          ...desktopRow(28),
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <Cover book={book} covers={covers} width={150} shadow />
        <div
          style={{
            ...DESKTOP_DETAILS,
            flexBasis: 220,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={eyebrow(theme.muted)}>
              {lead} · {rel}
            </div>
            <Title text={displayTitle} size={32} color={theme.ink} />
            <div style={{ fontSize: 13.5, color: theme.muted }}>{author}</div>
          </div>
          <Progress
            book={book}
            pos={pos}
            ink={theme.ink}
            track={theme.rule}
            height={5}
            fontSize={13}
          />
          <div style={ACTIONS_ROW}>
            <ResumeButton
              theme={theme}
              book={book}
              label={
                book.lastReadAt
                  ? tr("library.resumeReading")
                  : tr("library.startReading")
              }
              onOpen={onOpen}
            />
            <MoreButton theme={theme} book={book} onMenu={onMenu} />
          </div>
        </div>
      </div>
      <div
        style={{
          flex: "1 1 260px",
          padding: "14px 10px 10px",
          borderRadius: 16,
          border: `0.5px solid ${theme.ruleStrong}`,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div style={{ ...eyebrow(theme.muted), padding: "4px 10px 10px" }}>
          {tr("library.alsoReading")}
        </div>
        {rows}
      </div>
    </div>
  );
}
