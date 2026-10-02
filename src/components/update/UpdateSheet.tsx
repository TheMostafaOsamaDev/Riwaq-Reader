// The phone update sheet and its two toasts, read straight from the Android
// update store. One MobileSheet, its body switched on `sheet`: the notes
// (What's new), the mobile-data question, download progress, the one-time
// install permission, ready, and failed. Every button is a store action; the
// store re-reads the native status after each, so nothing here assumes an
// action took effect.

import { type ReactNode, useState } from "react";
import type { Tr } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import {
  type AndroidUpdateState,
  cancel,
  closeSheet,
  dismissToast,
  install,
  later,
  openPermission,
  openSheet,
  openStoreApp,
  retry,
  type Sheet,
  skip,
  startDownload,
  undoSkip,
  useAndroidUpdate,
} from "../../store/androidUpdate";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
  TOUCH_TARGET_MIN,
  Z,
} from "../../styles/tokens";
import { BrandMark } from "../BrandMark";
import { Button } from "../Button";
import { Icon, type IconProps } from "../Icon";
import { MobileSheet } from "../MobileSheet";
import { NotesView } from "./NotesView";
import {
  IconBadge,
  mb,
  NotesLoading,
  ProgressBar,
  UPDATE_TOAST_BOTTOM,
  UpdateToast,
  VISUALLY_HIDDEN,
} from "./parts";

/** The failed sheet's sentence for a native (or fetch) error code. */
function failText(
  s: AndroidUpdateState,
  tr: Tr,
): { text: string; resumable: boolean } {
  const code = s.fetchError ?? s.native.error;
  const size = s.apk?.size ?? s.native.total;
  switch (code) {
    case "checksum":
      return { text: tr("update.fail.checksum"), resumable: false };
    case "signature":
      return { text: tr("update.fail.signature"), resumable: false };
    case "storage":
      return {
        text: tr("update.fail.storage", { mb: mb(size) }),
        resumable: false,
      };
    case "install":
      return { text: tr("update.fail.install"), resumable: false };
    default: {
      // Nothing was ever downloaded (the APK's details could not be
      // fetched, or the download died before its first byte): there is no
      // percentage to report and nothing to resume.
      const { bytes, total } = s.native;
      if (s.fetchError || bytes === 0) {
        return { text: tr("update.fail.offlineStart"), resumable: false };
      }
      // "offline", and anything unrecognised: the file is kept and the next
      // start resumes from where it stopped.
      const p = total ? Math.min(100, Math.floor((bytes / total) * 100)) : 0;
      return { text: tr("update.fail.offline", { p }), resumable: true };
    }
  }
}

/** Which body to draw. The progress sheet follows the native state: when the
 *  download finishes or fails under an open sheet, it turns into that sheet
 *  rather than sitting at 100%. */
function viewFor(s: AndroidUpdateState): Sheet {
  if (s.sheet !== "progress") return s.sheet;
  const n = s.native.state;
  if (n === "ready" || n === "installing") return "ready";
  if (n === "failed") return "failed";
  return "progress";
}

const btn = { minHeight: TOUCH_TARGET_MIN } as const;
const showNotes = () => openSheet("notes");

function Head({
  theme,
  icon,
  iconColor,
  title,
  sub,
  lead,
}: {
  theme: Theme;
  icon?: IconProps["name"];
  iconColor?: string;
  title: string;
  sub?: string;
  lead?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "4px 20px 14px",
        flex: "none",
      }}
    >
      {lead ??
        (icon && (
          <IconBadge
            theme={theme}
            icon={icon}
            size={40}
            radius={12}
            iconSize={19}
            stroke={2}
            color={iconColor}
          />
        ))}
      <div style={{ minWidth: 0 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: FONT_SERIF_DISPLAY,
            fontSize: 19,
            fontWeight: 600,
            lineHeight: 1.25,
          }}
        >
          {title}
        </h2>
        {sub && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12.5,
              color: theme.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "0 20px",
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

/** Actions, pinned to the visible bottom edge. */
function Foot({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: "auto",
        padding:
          "14px 20px max(16px, calc(env(safe-area-inset-bottom, 0px) + 12px))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flex: "none",
      }}
    >
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: 8 }}>{children}</div>;
}

/** The quiet "Hide" every in-flight sheet ends with: the work goes on. */
function HideButton({ theme }: { theme: Theme }) {
  const { tr } = useI18n();
  return (
    <Button
      theme={theme}
      variant="ghost"
      fullWidth
      style={btn}
      onClick={closeSheet}
    >
      {tr("update.dl.hide")}
    </Button>
  );
}

export function UpdateSheet({
  theme,
  themeKey,
}: {
  theme: Theme;
  /** For the app icon in the notes header; omitted, the header has none. */
  themeKey?: ThemeKey;
}) {
  const { tr, dir } = useI18n();
  const s = useAndroidUpdate();
  const [busy, setBusy] = useState(false);
  const v = s.offer?.version ?? "";
  const open = s.sheet !== "closed" && !!s.offer;
  const view = viewFor(s);
  const size = s.apk ? mb(s.apk.size) : null;

  /** Run an action once: a second tap while it is pending does nothing. */
  const run = (fn: () => Promise<unknown> | unknown) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  let title = "";
  let content: ReactNode = null;

  if (view === "notes") {
    const assisted = s.channel?.kind === "store-assisted" ? s.channel : null;
    title = tr("whatsNew.title", { v });
    const date = s.notes?.notes?.date;
    const sub = [date, size && tr("update.sheet.size", { mb: size })]
      .filter(Boolean)
      .join(" · ");
    content = (
      <>
        <Head
          theme={theme}
          title={title}
          sub={sub || undefined}
          lead={
            themeKey ? (
              <BrandMark
                themeKey={themeKey}
                size={40}
                style={{ flex: "none" }}
              />
            ) : undefined
          }
        />
        <div
          data-sheet-scrollable
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            padding: "0 20px",
          }}
        >
          {s.notes === null ? (
            <NotesLoading theme={theme} />
          ) : (
            <NotesView
              notes={s.notes.notes}
              theme={theme}
              fallbackVersion={v}
              imageUrl={(n) =>
                n === s.notes?.notes?.highlight?.image
                  ? s.notes?.highlightImage
                  : undefined
              }
            />
          )}
        </div>
        <Foot>
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            style={btn}
            loading={busy}
            disabled={busy}
            onClick={run(() => (assisted ? openStoreApp() : startDownload()))}
          >
            {assisted
              ? tr("update.sheet.inStore", { store: assisted.label })
              : size
                ? tr("update.sheet.update", { mb: size })
                : tr("update.action.install")}
          </Button>
          <Row>
            <Button
              theme={theme}
              variant="outline"
              fullWidth
              style={btn}
              onClick={later}
            >
              {tr("update.action.later")}
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              fullWidth
              style={btn}
              onClick={() => void skip(v)}
            >
              {tr("update.sheet.skip")}
            </Button>
          </Row>
        </Foot>
      </>
    );
  } else if (view === "mobile") {
    title = tr("update.available", { v });
    content = (
      <>
        <Head theme={theme} icon="arrowUp" title={title} />
        <Body>
          <p
            style={{
              margin: 0,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "12px 14px",
              borderRadius: 12,
              background: theme.hover,
            }}
          >
            <Icon
              name="alert"
              size={17}
              style={{ flex: "none", marginTop: 2 }}
            />
            <span>{tr("update.mobile.warn", { mb: size ?? "–" })}</span>
          </p>
        </Body>
        <Foot>
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            style={btn}
            leadingIcon={<Icon name="wifi" size={15} />}
            disabled={busy}
            onClick={run(() =>
              startDownload({ allowMetered: false, waitForWifi: true }),
            )}
          >
            {tr("update.mobile.wait")}
          </Button>
          <Button
            theme={theme}
            variant="outline"
            fullWidth
            style={btn}
            disabled={busy}
            onClick={run(() => startDownload({ allowMetered: true }))}
          >
            {tr("update.mobile.anyway")}
          </Button>
        </Foot>
      </>
    );
  } else if (view === "progress") {
    const { bytes, state } = s.native;
    const total = s.native.total || s.apk?.size || 0;
    const waiting = state === "waiting";
    title = tr("update.dl.title", { v });
    content = (
      <>
        <Head
          theme={theme}
          icon={waiting ? "wifi" : "download"}
          title={title}
        />
        <Body>
          <ProgressBar
            theme={theme}
            bytes={bytes}
            total={total}
            label={title}
            dir={dir}
            height={6}
            track={theme.hover}
          />
          {/* The state for screen readers; the figures below change on every
              poll, so they are not live (the progressbar carries the value). */}
          <span aria-live="polite" style={VISUALLY_HIDDEN}>
            {waiting
              ? tr("update.pill.waiting", { v })
              : tr("update.downloading")}
          </span>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 13,
              color: theme.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {waiting
              ? tr("update.pill.waiting", { v })
              : tr("update.dl.of", { a: mb(bytes), b: mb(total) })}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.muted }}>
            {tr("update.dl.keep")}
          </p>
        </Body>
        <Foot>
          <Row>
            <Button
              theme={theme}
              variant="outline"
              fullWidth
              style={btn}
              disabled={busy}
              onClick={run(cancel)}
            >
              {tr("update.dl.cancel")}
            </Button>
            <Button
              theme={theme}
              variant="primary"
              fullWidth
              style={btn}
              onClick={closeSheet}
            >
              {tr("update.dl.hide")}
            </Button>
          </Row>
        </Foot>
      </>
    );
  } else if (view === "permission") {
    title = tr("update.perm.title");
    content = (
      <>
        <Head theme={theme} icon="lock" title={title} />
        <Body>
          <p style={{ margin: 0 }}>{tr("update.perm.body")}</p>
        </Body>
        <Foot>
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            style={btn}
            trailingIcon={<Icon name="externalLink" size={14} />}
            onClick={() => void openPermission()}
          >
            {tr("update.perm.open")}
          </Button>
          <HideButton theme={theme} />
        </Foot>
      </>
    );
  } else if (view === "ready") {
    title = tr("update.ready.title");
    content = (
      <>
        <Head theme={theme} icon="check" title={title} sub={v} />
        <Body>
          <p style={{ margin: 0 }}>{tr("update.ready.body")}</p>
        </Body>
        <Foot>
          {/* Stays tappable while native says "installing": a re-tap brings
              back a system dialog that never appeared. */}
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            style={btn}
            disabled={busy}
            onClick={run(install)}
          >
            {tr("update.ready.install")}
          </Button>
          <HideButton theme={theme} />
        </Foot>
      </>
    );
  } else if (view === "failed") {
    const f = failText(s, tr);
    title = tr("update.fail.title");
    content = (
      <>
        <Head
          theme={theme}
          icon="alert"
          iconColor={theme.danger}
          title={title}
          sub={v}
        />
        <Body>
          <p role="alert" style={{ margin: 0 }}>
            {f.text}
          </p>
        </Body>
        <Foot>
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            style={btn}
            loading={busy}
            disabled={busy}
            onClick={run(retry)}
          >
            {f.resumable ? tr("update.fail.resume") : tr("update.fail.again")}
          </Button>
          <HideButton theme={theme} />
        </Foot>
      </>
    );
  }

  return (
    // MobileSheet positions itself absolutely over its parent; this layer
    // lifts it over the library, Settings and the pill. Click-through while
    // closed, so the exit animation never blocks the page under it.
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.dialog,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <MobileSheet
        theme={theme}
        open={open}
        onClose={closeSheet}
        height={view === "notes" ? "86%" : "52%"}
        label={title || undefined}
      >
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            paddingBottom: "var(--sheet-overhang, 0px)",
            fontFamily: FONT_STACKS.sans,
            color: theme.ink,
          }}
        >
          {content}
        </div>
      </MobileSheet>
    </div>
  );
}

/** "Later" and "Skip" confirmations. Lifted over the phone's bottom bar. */
export function UpdateToasts({
  theme,
  layout = "mobile",
}: {
  theme: Theme;
  /** "mobile" lifts the toast over MobileBottomNav; "desktop" keeps the
   *  ordinary toast position. */
  layout?: "mobile" | "desktop";
}) {
  const s = useAndroidUpdate();
  return (
    <UpdateToast
      theme={theme}
      kind={s.toast}
      seq={s.toastSeq}
      version={s.offer?.version ?? ""}
      onShow={showNotes}
      onUndo={undoSkip}
      onDismiss={dismissToast}
      bottom={layout === "mobile" ? UPDATE_TOAST_BOTTOM : undefined}
    />
  );
}
