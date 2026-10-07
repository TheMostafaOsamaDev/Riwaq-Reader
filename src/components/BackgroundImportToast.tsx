// The status card for a book opened from outside the app (Open with, the
// Android share sheet, a drag-and-drop). It reports what the background
// importer (store/backgroundImport.ts) is doing, on whatever screen is up.
//
// It never blocks: no scrim, no focus grab, polite announcements only. The
// page under it stays readable and tappable, which is the point of running
// the import in the background at all.
//
// Lifetimes follow what the message is for. A success with nothing left to
// do goes on its own after a few seconds (paused while hovered or focused, so
// it can't vanish under a pointer reaching for "Edit details"). A failure
// stays until dismissed or retried — it is the only place that says so.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  dismissBackgroundImport,
  enqueueImport,
  hideBackgroundImport,
  useBackgroundImport,
  type BackgroundImportResult,
  type BackgroundImportView,
} from "../store/backgroundImport";
import {
  getState as getProgress,
  subscribe as subscribeProgress,
} from "../store/importProgress";
import { requestEditBook } from "../store/uiIntents";
import { getState as getNavState, goLibrary } from "../store/navigation";
import { formatNum } from "../i18n";
import { knownErrorLabel } from "../i18n/statusLabels";
import { useI18n } from "../i18n/useI18n";
import { transition, useReducedMotion } from "../styles/motion";
import { FONT_STACKS, type Theme, Z } from "../styles/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { TOAST_WARN } from "./Toast";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  onOpenBook: (bookId: string) => void;
}

/** A plain success, or a result whose only action is optional. */
const SHORT_MS = 4500;
/** A result that offers something worth doing (Open, Edit details). */
const LONG_MS = 7000;

/** Clears the mobile bottom bar and the reader's bottom chrome. */
const MOBILE_OFFSET = 84;
const DESKTOP_OFFSET = 24;

export function BackgroundImportToast({ theme, layout, onOpenBook }: Props) {
  const view = useBackgroundImport();
  if (view.kind === "idle") return null;
  if (view.kind === "working" && view.hidden) return null;
  return (
    <Card
      // Remount per result so the entrance plays and the timer restarts.
      key={view.kind === "result" ? `r${view.seq}` : view.kind}
      theme={theme}
      layout={layout}
      view={view}
      onOpenBook={onOpenBook}
    />
  );
}

type Tone = "neutral" | "success" | "warn" | "error";

interface Content {
  tone: Tone;
  title: string;
  detail?: string;
  /** Primary first. At most two, so a phone-width card never wraps them. */
  actions: { label: string; onClick: () => void }[];
  /** Milliseconds before it goes on its own; null to stay. */
  ttl: number | null;
  /** Shows "Hide" (running) or "Close" (finished). */
  closable: boolean;
}

/** Two frames, then true: drives an entrance transition. A mount keyframe
 *  would be simpler, but WebKit can skip or hold one on a freshly mounted
 *  node, so the card moves by transition instead — and only `transform`, so
 *  it is fully visible from its first frame either way. */
function useEntered(reduced: boolean): boolean {
  const [entered, setEntered] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [reduced]);
  return entered;
}

function Card({
  theme,
  layout,
  view,
  onOpenBook,
}: {
  theme: Theme;
  layout: "desktop" | "mobile";
  view: Exclude<BackgroundImportView, { kind: "idle" }>;
  onOpenBook: (bookId: string) => void;
}) {
  const { tr, locale } = useI18n();
  const reduced = useReducedMotion();
  const entered = useEntered(reduced);
  const mobile = layout === "mobile";

  const close = () => {
    if (view.kind === "result") dismissBackgroundImport(view.seq);
    else hideBackgroundImport();
  };

  const content = describe(view, {
    tr,
    num: (n) => formatNum(n, locale),
    open: (id) => {
      close();
      onOpenBook(id);
    },
    edit: (id) => {
      close();
      requestEditBook(id);
      // The edit dialog belongs to the library; get there first. From the
      // reader that closes the book, which the user just asked for by
      // choosing to edit it.
      if (getNavState().snapshot.base.screen !== "library") {
        goLibrary({ kind: "shelf" });
      }
    },
    viewLibrary: () => {
      close();
      goLibrary({ kind: "shelf" });
    },
    retry: enqueueImport,
  });

  // Auto-dismiss, paused while the pointer or focus is inside.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (content.ttl === null || paused) return;
    const t = window.setTimeout(close, content.ttl);
    return () => window.clearTimeout(t);
    // `close` is stable for a given view, and the card remounts per result.
  }, [content.ttl, paused]);

  const accent =
    content.tone === "error"
      ? theme.danger
      : content.tone === "warn"
        ? TOAST_WARN
        : theme.ink;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
      style={{
        position: "fixed",
        insetInline: 0,
        marginInline: "auto",
        bottom: `calc(var(--safe-bottom) + ${
          mobile ? MOBILE_OFFSET : DESKTOP_OFFSET
        }px)`,
        width: mobile ? "calc(100vw - 32px)" : 420,
        maxWidth: "calc(100vw - 32px)",
        boxSizing: "border-box",
        zIndex: Z.toast,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.ruleStrong}`,
        borderRadius: 14,
        boxShadow: "0 10px 32px rgba(0,0,0,0.18)",
        paddingBlock: 10,
        paddingInlineStart: 14,
        paddingInlineEnd: 6,
        fontFamily: FONT_STACKS.sans,
        transform: entered ? "translateY(0)" : "translateY(10px)",
        transition: transition("transform", "med", "enter", reduced),
        // A dragged selection over the reader must not start in here.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {view.kind === "working" ? (
          <ProgressRing color={theme.ink} />
        ) : (
          <Glyph theme={theme} tone={content.tone} color={accent} />
        )}
        <div style={{ flex: 1, minWidth: 0, paddingBlock: 2 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              color: theme.ink,
              ...clamp(2),
            }}
          >
            {content.title}
          </div>
          {content.detail && (
            <div
              style={{
                marginTop: 2,
                fontSize: 12.5,
                lineHeight: 1.4,
                color: theme.muted,
                ...clamp(2),
              }}
            >
              {content.detail}
            </div>
          )}
        </div>
        {content.closable && (
          <Button
            theme={theme}
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={
              view.kind === "result" ? tr("common.close") : tr("bgImport.hide")
            }
            title={
              view.kind === "result" ? tr("common.close") : tr("bgImport.hide")
            }
            onClick={close}
            style={{ flexShrink: 0, color: theme.muted }}
          >
            <Icon name="close" size={16} />
          </Button>
        )}
      </div>

      {content.actions.length > 0 && (
        // Their own row, under the text and lined up with it: two buttons
        // beside a title leave a phone-width card no room for the title.
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
            paddingInlineStart: 44,
            paddingInlineEnd: 8,
          }}
        >
          {/* Primary last: it sits at the inline end, where the eye lands
              after reading the line — right in LTR, left in RTL. */}
          {content.actions
            .map((a, i) => (
              <Button
                key={a.label}
                theme={theme}
                variant={i === 0 ? "primary" : "outline"}
                size="sm"
                onClick={a.onClick}
                style={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {a.label}
              </Button>
            ))
            .reverse()}
        </div>
      )}
    </div>
  );
}

/** Two lines, then an ellipsis — a long title must never push the close
 *  button off the card. `anywhere` because a file name has no spaces. */
function clamp(lines: number) {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
  } as const;
}

// ── what to say ───────────────────────────────────────────────────────────

interface Helpers {
  tr: ReturnType<typeof useI18n>["tr"];
  num: (n: number) => string;
  open: (bookId: string) => void;
  edit: (bookId: string) => void;
  viewLibrary: () => void;
  retry: (paths: string[]) => void;
}

/** The copy and actions for a state. Exported for tests: the rules about
 *  which result offers what are the part worth pinning down. */
export function describe(
  view: Exclude<BackgroundImportView, { kind: "idle" }>,
  h: Helpers,
): Content {
  const { tr, num } = h;

  if (view.kind === "queued") {
    return {
      tone: "neutral",
      title:
        view.files === 1
          ? tr("bgImport.queuedOne")
          : tr("bgImport.queuedOther", { n: num(view.files) }),
      detail: tr("bgImport.queuedSub"),
      actions: [],
      ttl: null,
      closable: false,
    };
  }

  if (view.kind === "working") {
    const parts: string[] = [];
    if (view.total > 1) {
      parts.push(
        tr("bgImport.progress", {
          i: num(view.index + 1),
          n: num(view.total),
        }),
      );
    }
    if (view.waiting > 0) {
      parts.push(tr("bgImport.waiting", { n: num(view.waiting) }));
    }
    return {
      tone: "neutral",
      title: view.name
        ? tr("bgImport.importing", { name: view.name })
        : tr("bgImport.preparing"),
      detail: parts.length > 0 ? parts.join(tr("bgImport.sep")) : undefined,
      actions: [],
      ttl: null,
      closable: true,
    };
  }

  return describeResult(view.result, h);
}

function describeResult(r: BackgroundImportResult, h: Helpers): Content {
  const { tr, num } = h;
  const books = [...r.added, ...r.reused];
  // `retryable` is false for a file that isn't a book: it fails the same way
  // every time, so a Retry button could only disappoint.
  const retryable = r.failed.filter((f) => f.retryable).map((f) => f.path);
  const retry =
    retryable.length > 0
      ? [{ label: tr("common.retry"), onClick: () => h.retry(retryable) }]
      : [];

  if (r.failed.length > 0) {
    const first = r.failed[0];
    const reason = friendlyError(first.message, tr);
    if (books.length === 0) {
      return {
        tone: "error",
        title:
          r.failed.length === 1
            ? tr("bgImport.failedOne", { name: first.name })
            : tr("bgImport.failedOther", { n: num(r.failed.length) }),
        detail: reason,
        actions: retry,
        ttl: null,
        closable: true,
      };
    }
    return {
      tone: "warn",
      title: tr("bgImport.partial", {
        added: num(books.length),
        failed: num(r.failed.length),
      }),
      detail: r.failed.length === 1 ? `${first.name}: ${reason}` : reason,
      actions: retry,
      ttl: null,
      closable: true,
    };
  }

  if (books.length === 1) {
    const book = books[0];
    const isNew = r.added.length === 1;
    const actions: Content["actions"] = [];
    // Opened already, or the user moved on and gets the choice instead.
    if (r.opened !== book.id) {
      actions.push({
        label: tr("bgImport.open"),
        onClick: () => h.open(book.id),
      });
    }
    // Only a new book was given default details; one already in the library
    // has whatever the user set before.
    if (isNew) {
      actions.push({
        label: tr("bgImport.edit"),
        onClick: () => h.edit(book.id),
      });
    }
    return {
      tone: "success",
      title: isNew ? tr("bgImport.added") : tr("bgImport.alreadyHave"),
      detail: book.title,
      actions,
      ttl: actions.length > 0 ? LONG_MS : SHORT_MS,
      closable: true,
    };
  }

  // Several books: nothing opens (no defensible choice of which), so the
  // useful next step is the shelf they landed on.
  const title =
    r.added.length > 0
      ? tr("bgImport.addedOther", { n: num(r.added.length) })
      : tr("bgImport.alreadyHaveOther", { n: num(r.reused.length) });
  const detail =
    r.added.length > 0 && r.reused.length > 0
      ? tr("bgImport.alreadyHaveOther", { n: num(r.reused.length) })
      : undefined;
  return {
    tone: "success",
    title,
    detail,
    actions: [{ label: tr("bgImport.viewLibrary"), onClick: h.viewLibrary }],
    ttl: LONG_MS,
    closable: true,
  };
}

/** A message the app knows how to word, or a plain "couldn't read it". The
 *  raw text of an unknown failure is an OS or provider error ("Permission
 *  Denial: opening provider …"), which helps nobody reading a toast; the
 *  importer logs it. */
function friendlyError(raw: string, tr: Helpers["tr"]): string {
  return knownErrorLabel(raw, tr) ?? tr("bgImport.unreadable");
}

// ── pieces ────────────────────────────────────────────────────────────────

const LEAD = 32;

/** The running import's ring: the same Spinner, fed the same number, as the
 *  FAB's. Subscribes to just that number, so the rest of the card does not
 *  re-render on every progress tick, nor on the label-only ones. */
function ProgressRing({ color }: { color: string }) {
  const ratio = useSyncExternalStore(
    subscribeProgress,
    () => getProgress().overall,
  );
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      style={{ width: LEAD, height: LEAD, flexShrink: 0, color }}
    >
      {/* A sliver even at 0%, so the ring reads as started. */}
      <Spinner size={LEAD} strokeWidth={3} value={Math.max(0.03, ratio)} />
    </div>
  );
}

function Glyph({
  theme,
  tone,
  color,
}: {
  theme: Theme;
  tone: Tone;
  color: string;
}) {
  const icon =
    tone === "error"
      ? "xCirc"
      : tone === "warn"
        ? "info"
        : tone === "success"
          ? "check"
          : "clock";
  return (
    <div
      aria-hidden="true"
      style={{
        width: LEAD,
        height: LEAD,
        flexShrink: 0,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        background: theme.paper,
        border: `0.5px solid ${theme.rule}`,
      }}
    >
      <Icon name={icon} size={17} stroke={1.8} />
    </div>
  );
}
