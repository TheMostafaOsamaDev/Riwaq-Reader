import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { BookCover } from "./BookCover";
import { Button } from "./Button";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { paletteForId } from "../store/palette";
import type { BookIndexEntry } from "../store/library";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onSave: (patch: {
    title: string;
    author: string;
    description: string;
  }) => Promise<void> | void;
  onClose: () => void;
  onDelete: () => Promise<void> | void;
  onSetCover: () => Promise<void> | void;
  onRescanCover: () => Promise<void> | void;
}

// Match the context-menu's enter/exit so the two surfaces feel like they
// belong to the same family.
const ENTER_MS = 260;
const EXIT_MS = 200;
const ENTER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXIT_EASE = "cubic-bezier(0.4, 0, 1, 1)";

export function EditBookModal({
  theme,
  book,
  coverSrc,
  onSave,
  onClose,
  onDelete,
  onSetCover,
  onRescanCover,
}: Props) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [description, setDescription] = useState(book.description ?? "");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [entered, setEntered] = useState(false);

  // Same touch detection the context menu uses — broaden past `(hover: none)`
  // so Android Chrome configs reporting `hover: hover` still get the mobile
  // layout.
  const mqTouch = useMediaQuery("(hover: none), (pointer: coarse)");
  const isTouch =
    mqTouch ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

  // Refresh local state if the parent swaps which book is being edited
  // (e.g. after rescan/setCover where the parent resets the entry).
  useEffect(() => {
    setTitle(book.title);
    setAuthor(book.author);
    setDescription(book.description ?? "");
  }, [book.id, book.title, book.author, book.description]);

  // One-frame defer so the first paint is at translateY(100%) and the second
  // paint at translateY(0) — the browser interpolates between them.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = useCallback(() => {
    if (leaving) return;
    // Desktop modal doesn't have a slide-out — closing should be immediate so
    // we don't introduce a 200ms blank delay before unmount. Touch path needs
    // the delay so the slide-down animation finishes before onClose fires.
    if (!isTouch) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(() => onClose(), EXIT_MS);
  }, [isTouch, leaving, onClose]);

  // Esc closes via the slide-out so the page doesn't snap shut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || book.title,
        author: author.trim(),
        description: description.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  if (isTouch) {
    return (
      <MobileEditPage
        theme={theme}
        book={book}
        coverSrc={coverSrc}
        title={title}
        author={author}
        description={description}
        saving={saving}
        entered={entered}
        leaving={leaving}
        onTitleChange={setTitle}
        onAuthorChange={setAuthor}
        onDescriptionChange={setDescription}
        onSave={submit}
        onClose={requestClose}
        onDelete={onDelete}
        onSetCover={onSetCover}
        onRescanCover={onRescanCover}
      />
    );
  }

  // Desktop / hover-capable: original centered modal.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit book details"
      onClick={requestClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: `0.5px solid ${theme.rule}`,
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `0.5px solid ${theme.rule}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_SERIF_DISPLAY,
                fontStyle: "italic",
                fontSize: 18,
                color: theme.ink,
              }}
            >
              Edit book
            </div>
            <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
              Title, author, description, and cover
            </div>
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "transparent",
              color: theme.chromeInk,
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 20,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <BookCover
              title={book.title}
              author={book.author}
              palette={paletteForId(book.id)}
              size="md"
              src={coverSrc}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Button
                theme={theme}
                variant="outline"
                size="sm"
                onClick={() => onSetCover()}
              >
                Replace cover…
              </Button>
              <Button
                theme={theme}
                variant="outline"
                size="sm"
                onClick={() => onRescanCover()}
              >
                Rescan from EPUB
              </Button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldLabel theme={theme}>Title</FieldLabel>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={textInput(theme)}
            />

            <FieldLabel theme={theme}>Author</FieldLabel>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              style={textInput(theme)}
            />

            <FieldLabel theme={theme}>Description</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              style={{
                ...textInput(theme),
                resize: "vertical",
                minHeight: 100,
                fontFamily: FONT_STACKS.sans,
              }}
            />
          </div>
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: `0.5px solid ${theme.rule}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Button
            theme={theme}
            variant="destructive"
            size="sm"
            onClick={() => void onDelete()}
          >
            Remove from library
          </Button>
          <div style={{ flex: 1 }} />
          <Button theme={theme} variant="outline" size="sm" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface MobileProps {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  title: string;
  author: string;
  description: string;
  saving: boolean;
  entered: boolean;
  leaving: boolean;
  onTitleChange: (s: string) => void;
  onAuthorChange: (s: string) => void;
  onDescriptionChange: (s: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete: () => Promise<void> | void;
  onSetCover: () => Promise<void> | void;
  onRescanCover: () => Promise<void> | void;
}

function MobileEditPage({
  theme,
  book,
  coverSrc,
  title,
  author,
  description,
  saving,
  entered,
  leaving,
  onTitleChange,
  onAuthorChange,
  onDescriptionChange,
  onSave,
  onClose,
  onDelete,
  onSetCover,
  onRescanCover,
}: MobileProps) {
  // Track Save's disabled state separately from `saving` so the visual stays
  // accurate during the in-flight request. We don't gate on dirtiness — users
  // expect Save to always be tappable on a phone, and the parent already
  // handles "nothing changed" gracefully.
  const saveDisabled = saving;

  const slideTransform = entered && !leaving ? "translateY(0)" : "translateY(100%)";
  const slideTransition = `transform ${leaving ? EXIT_MS : ENTER_MS}ms ${
    leaving ? EXIT_EASE : ENTER_EASE
  }`;
  const backdropOpacity = entered && !leaving ? 1 : 0;
  const backdropTransition = `opacity ${
    leaving ? EXIT_MS : ENTER_MS
  }ms ease`;

  return (
    <>
      {/* Thin dim under the page so the library doesn't show through at the
          rounded top corners if the page is short. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 8999,
          opacity: backdropOpacity,
          transition: backdropTransition,
          pointerEvents: leaving ? "none" : "auto",
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit book details"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          // Cap at the visual viewport. Using min-height: 100% would push the
          // bottom past safe-area; explicit bounds keep us tidy.
          top: 0,
          zIndex: 9000,
          background: theme.bg,
          color: theme.ink,
          fontFamily: FONT_STACKS.sans,
          display: "flex",
          flexDirection: "column",
          transform: slideTransform,
          transition: slideTransition,
          // Rounded top corners give it a "sheet that filled the screen" feel
          // rather than a flat page — but only at the very top, since the
          // bottom hugs the safe area.
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Sticky header — Close (left), title (centred), Save (right). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px",
            paddingTop: `max(10px, env(safe-area-inset-top, 10px))`,
            borderBottom: `0.5px solid ${theme.rule}`,
            background: theme.bg,
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 40,
              height: 40,
              border: "none",
              background: "transparent",
              color: theme.ink,
              borderRadius: 10,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Icon name="close" size={18} stroke={1.7} />
          </button>
          <div
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontSize: 17,
              color: theme.ink,
              textAlign: "center",
              flex: "1 1 auto",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Edit book
          </div>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={saveDisabled}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {/* Scrollable body. */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "20px 18px",
            paddingBottom: `max(28px, env(safe-area-inset-bottom, 28px))`,
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          {/* Cover hero — centered, with replace/rescan beneath. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <BookCover
              title={book.title}
              author={book.author}
              palette={paletteForId(book.id)}
              size="md"
              src={coverSrc}
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <Button
                theme={theme}
                variant="outline"
                size="sm"
                onClick={() => onSetCover()}
              >
                Replace cover…
              </Button>
              <Button
                theme={theme}
                variant="outline"
                size="sm"
                onClick={() => onRescanCover()}
              >
                Rescan from EPUB
              </Button>
            </div>
          </div>

          {/* Form fields — each in its own labeled block. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Field label="Title" theme={theme}>
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                style={mobileInput(theme)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field label="Author" theme={theme}>
              <input
                value={author}
                onChange={(e) => onAuthorChange(e.target.value)}
                style={mobileInput(theme)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>

            <Field label="Description" theme={theme}>
              <textarea
                value={description}
                onChange={(e) => onDescriptionChange(e.target.value)}
                rows={5}
                style={{
                  ...mobileInput(theme),
                  // Disable manual resize on mobile — the textarea grows by
                  // rows-prop on phones, and a corner-drag affordance is
                  // useless on touch.
                  resize: "none",
                  minHeight: 120,
                  lineHeight: 1.5,
                  fontFamily: FONT_STACKS.sans,
                }}
              />
            </Field>
          </div>

          {/* Destructive action at the very end of the form — Apple/Material
              pattern. Large, full-width, intentionally below the fold for the
              average phone so it isn't a fat-finger hazard. */}
          <Button
            theme={theme}
            variant="destructive"
            size="md"
            fullWidth
            onClick={() => void onDelete()}
            leadingIcon={<Icon name="trash" size={16} stroke={1.7} />}
          >
            Remove from library
          </Button>
        </div>
      </div>
    </>
  );
}

function FieldLabel({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: theme.muted,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  theme,
  children,
}: {
  label: string;
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <FieldLabel theme={theme}>{label}</FieldLabel>
      {children}
    </div>
  );
}

function textInput(theme: Theme): React.CSSProperties {
  return {
    width: "100%",
    background: theme.chrome,
    color: theme.ink,
    border: `0.5px solid ${theme.rule}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: FONT_STACKS.sans,
    outline: "none",
  };
}

function mobileInput(theme: Theme): React.CSSProperties {
  return {
    width: "100%",
    background: theme.chrome,
    color: theme.ink,
    border: `0.5px solid ${theme.rule}`,
    borderRadius: 10,
    padding: "12px 14px",
    // 16px or larger prevents iOS Safari from zooming into the input on focus.
    fontSize: 16,
    fontFamily: FONT_STACKS.sans,
    outline: "none",
    boxSizing: "border-box",
  };
}
