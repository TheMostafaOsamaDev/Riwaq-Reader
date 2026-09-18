// The Extensions manager — install, update and remove source extensions,
// and manage the repositories they are offered from.
//
// Reached from the Store's sources list (a control in its header) and
// returns the same way, so it is a fourth Store view rather than a fifth
// app tab: extensions exist to serve the Store, and nothing outside it.
//
// Every mutation is followed by `initExtensions()` and a fresh
// `loadCatalog()`. initExtensions is the registry's refresh path and is
// cheap to re-run — it re-lists from disk and only re-evaluates bundles
// whose content hash changed — so the Store's sources list and this view
// agree the moment an install or a removal finishes, with no app restart.
//
// The I/O lives behind `deps` for the same reason install.ts takes an
// `InstallDeps`: it is what lets the tests drive all five card states, and
// a throwaway browser harness render the view with no Tauri bridge at all.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "../extensions/catalog";
import {
  installExtension as realInstall,
  uninstallExtension as realUninstall,
} from "../extensions/install";
import {
  acknowledgeTrustNotice as realAcknowledgeTrust,
  addRepo as realAddRepo,
  hasAcknowledgedTrustNotice as realHasAcknowledgedTrust,
  OFFICIAL_REPO_URL,
  removeRepo as realRemoveRepo,
  type RepoEntry,
  type RepoIndexEntry,
  resolveAssetUrl,
} from "../extensions/repos";
import { useI18n } from "../i18n/useI18n";
import {
  getExtensionError as realGetError,
  getExtensionStatus as realGetStatus,
  getSourceMeta as realGetMeta,
  initExtensions as realInit,
  loadCatalog as realLoadCatalog,
} from "../sources/registry";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { AnimatedDialog } from "./AnimatedDialog";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  type CardAction,
  ExtensionCard,
  type ExtensionStatus,
} from "./extensions/ExtensionCard";
import {
  type AddOutcome,
  type RepoContent,
  RepoList,
} from "./extensions/RepoList";
import { Icon } from "./Icon";
import { ThemedSkeleton } from "./Skeleton";

export interface CatalogData {
  repos: RepoEntry[];
  contents: RepoContent[];
  catalog: CatalogEntry[];
}

export interface ExtensionsDeps {
  loadCatalog: () => Promise<CatalogData>;
  initExtensions: () => Promise<void>;
  getExtensionStatus: (id: string) => ExtensionStatus;
  getExtensionError: (id: string) => string | undefined;
  getSourceIconUrl: (id: string) => string | undefined;
  installExtension: (repoUrl: string, entry: RepoIndexEntry) => Promise<void>;
  uninstallExtension: (id: string) => Promise<void>;
  addRepo: (url: string) => Promise<unknown>;
  removeRepo: (url: string) => Promise<void>;
  hasAcknowledgedTrustNotice: () => Promise<boolean>;
  acknowledgeTrustNotice: () => Promise<void>;
  officialRepoUrl: string;
}

export const DEFAULT_EXTENSIONS_DEPS: ExtensionsDeps = {
  loadCatalog: realLoadCatalog,
  initExtensions: realInit,
  getExtensionStatus: realGetStatus,
  getExtensionError: realGetError,
  getSourceIconUrl: (id) => realGetMeta(id)?.iconUrl,
  installExtension: (repoUrl, entry) => realInstall(repoUrl, entry),
  uninstallExtension: realUninstall,
  addRepo: realAddRepo,
  removeRepo: realRemoveRepo,
  hasAcknowledgedTrustNotice: realHasAcknowledgedTrust,
  acknowledgeTrustNotice: realAcknowledgeTrust,
  officialRepoUrl: OFFICIAL_REPO_URL,
};

interface Props {
  theme: Theme;
  onBack: () => void;
  deps?: ExtensionsDeps;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ExtensionsView({
  theme,
  onBack,
  deps = DEFAULT_EXTENSIONS_DEPS,
}: Props) {
  const { tr } = useI18n();
  const [data, setData] = useState<CatalogData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, CardAction>>({});
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [pendingRemove, setPendingRemove] = useState<CatalogEntry | null>(null);
  const [trustOpen, setTrustOpen] = useState(false);

  // The trust notice gates an in-flight `addRepo`, so the dialog's answer
  // has to travel back to the awaiting caller rather than into state.
  const trustResolve = useRef<((ok: boolean) => void) | null>(null);
  // Every async handler reads its I/O through this ref rather than closing
  // over the prop. Closing over it would put `deps` in each callback's
  // dependency list, and a caller passing an inline object would then get a
  // new `reload` on every render — i.e. a load effect that never stops
  // re-running.
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Never leave RepoList's submit awaiting a dialog that has unmounted.
      trustResolve.current?.(false);
      trustResolve.current = null;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await depsRef.current.loadCatalog();
      if (!alive.current) return;
      setData(next);
      setLoadError(null);
    } catch (e) {
      if (!alive.current) return;
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearCardError = (id: string) =>
    setCardError(({ [id]: _dropped, ...rest }) => rest);

  /** Install, update and Retry are one code path: `installExtension`
   *  re-downloads, re-verifies the hash and overwrites, so there is no
   *  separate update call. They differ only in the spinner they show and
   *  the sentence a failure gets. A failure leaves nothing behind —
   *  installExtension verifies before it writes — so the card simply
   *  returns to the state it was in, with the error and its retry inline. */
  const run = useCallback(
    async (
      item: CatalogEntry,
      action: Extract<CardAction, "install" | "update">,
      failureKey:
        | "extensions.installFailed"
        | "extensions.updateFailed"
        | "extensions.retryFailed",
    ) => {
      setBusy((b) => ({ ...b, [item.id]: action }));
      clearCardError(item.id);
      try {
        // No repo entry means the repo it came from was removed: there is
        // nothing to re-download, so a Retry can only re-run the loader —
        // which is the fix when the bundle failed to READ rather than to
        // evaluate.
        const canRedownload = Boolean(item.entry && item.repoUrl);
        if (item.entry && item.repoUrl) {
          await depsRef.current.installExtension(item.repoUrl, item.entry);
        }
        await depsRef.current.initExtensions();
        await reload();
        // A reload-only retry that changed nothing looks like a dead
        // button. Say why instead: the bundle's own evaluation failure is
        // cached by content hash, so re-running the loader cannot clear it
        // while the repo that could ship new bytes is gone.
        if (
          !canRedownload &&
          alive.current &&
          depsRef.current.getExtensionStatus(item.id) !== "ok"
        ) {
          setCardError((prev) => ({
            ...prev,
            [item.id]: tr("extensions.retryNoRepo"),
          }));
        }
      } catch (e) {
        if (!alive.current) return;
        setCardError((prev) => ({
          ...prev,
          [item.id]: tr(failureKey, { error: errorText(e) }),
        }));
      } finally {
        if (alive.current) {
          setBusy(({ [item.id]: _dropped, ...rest }) => rest);
        }
      }
    },
    [reload, tr],
  );

  const removeExtension = useCallback(
    async (item: CatalogEntry) => {
      setPendingRemove(null);
      setBusy((b) => ({ ...b, [item.id]: "remove" }));
      clearCardError(item.id);
      try {
        await depsRef.current.uninstallExtension(item.id);
        await depsRef.current.initExtensions();
        await reload();
      } catch (e) {
        if (!alive.current) return;
        setCardError((prev) => ({
          ...prev,
          [item.id]: tr("extensions.removeFailed", { error: errorText(e) }),
        }));
      } finally {
        if (alive.current) {
          setBusy(({ [item.id]: _dropped, ...rest }) => rest);
        }
      }
    },
    [reload, tr],
  );

  const settleTrust = (ok: boolean) => {
    setTrustOpen(false);
    const resolve = trustResolve.current;
    trustResolve.current = null;
    resolve?.(ok);
  };

  const addRepo = useCallback(
    async (url: string): Promise<AddOutcome> => {
      // Fires once, on the first repository the user adds themselves. The
      // acknowledgement is recorded only after the add succeeds, so a
      // failed first attempt still shows the notice on the next try.
      const needsNotice = !(await depsRef.current.hasAcknowledgedTrustNotice());
      if (needsNotice) {
        const accepted = await new Promise<boolean>((resolve) => {
          trustResolve.current = resolve;
          setTrustOpen(true);
        });
        if (!accepted) return "cancelled";
      }
      await depsRef.current.addRepo(url);
      if (needsNotice) await depsRef.current.acknowledgeTrustNotice();
      await depsRef.current.initExtensions();
      await reload();
      return "added";
    },
    [reload],
  );

  const removeRepo = useCallback(
    async (url: string) => {
      // Deliberately does not uninstall anything: the extensions that came
      // from this repo keep working, they just stop being offered updates.
      await depsRef.current.removeRepo(url);
      await depsRef.current.initExtensions();
      await reload();
    },
    [reload],
  );

  const iconFor = (item: CatalogEntry): string | undefined => {
    if (item.installed) return deps.getSourceIconUrl(item.id);
    if (!item.entry?.icon || !item.repoUrl) return undefined;
    try {
      return resolveAssetUrl(item.repoUrl, item.entry.icon);
    } catch {
      return undefined;
    }
  };

  const renderCard = (item: CatalogEntry) => (
    <ExtensionCard
      key={item.id}
      theme={theme}
      entry={item}
      status={deps.getExtensionStatus(item.id)}
      loadError={deps.getExtensionError(item.id)}
      iconUrl={iconFor(item)}
      busy={busy[item.id] ?? null}
      actionError={cardError[item.id]}
      onInstall={() => void run(item, "install", "extensions.installFailed")}
      onUpdate={() => void run(item, "update", "extensions.updateFailed")}
      onRetry={() => void run(item, "update", "extensions.retryFailed")}
      onRemove={() => setPendingRemove(item)}
    />
  );

  const installed = data?.catalog.filter((c) => c.installed) ?? [];
  const available = data?.catalog.filter((c) => !c.installed) ?? [];

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "28px 40px 40px",
        fontFamily: FONT_STACKS.sans,
        color: theme.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={tr("store.backToSources")}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            border: `0.5px solid ${theme.rule}`,
            background: theme.bg,
            color: theme.ink,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={18} className="rtl-flip-x" />
        </button>
        <h2
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontWeight: 400,
            fontSize: 26,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {tr("extensions.title")}
        </h2>
      </div>
      <p
        style={{
          margin: "0 0 24px 0",
          color: theme.muted,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {tr("extensions.subtitle")}
      </p>

      {data === null ? (
        loadError === null ? (
          <div style={{ display: "grid", gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <ThemedSkeleton
                key={i}
                theme={theme}
                width="100%"
                height={80}
                radius={12}
              />
            ))}
          </div>
        ) : (
          // Only when there is nothing at all to show. A single repo that
          // could not be reached is that repo's row's problem, not this.
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 13,
              lineHeight: 1.5,
              color: theme.danger,
            }}
          >
            <span>{tr("extensions.loadError", { error: loadError })}</span>
            <Button
              theme={theme}
              variant="secondary"
              size="sm"
              style={{ minHeight: 44, paddingInline: 14 }}
              onClick={() => void reload()}
            >
              {tr("extensions.retry")}
            </Button>
          </div>
        )
      ) : (
        <>
          {loadError !== null && (
            // A refresh that failed AFTER a list was already on screen. The
            // branch above only covers "nothing to show at all", so without
            // this the user would be looking at a stale list — an installed
            // extension still offering Install, a removed one still offering
            // Remove — with no sign anything went wrong, because reload()
            // swallows its own throw and the action that triggered it
            // reports success.
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
                padding: "10px 12px",
                borderRadius: 10,
                background: theme.hover,
                fontSize: 13,
                lineHeight: 1.5,
                color: theme.danger,
              }}
            >
              <span>{tr("extensions.staleList", { error: loadError })}</span>
              <Button
                theme={theme}
                variant="secondary"
                size="sm"
                style={{ minHeight: 44, paddingInline: 14 }}
                onClick={() => void reload()}
              >
                {tr("extensions.retry")}
              </Button>
            </div>
          )}

          <Section theme={theme} title={tr("extensions.installedHeading")}>
            {installed.length === 0 ? (
              <Empty theme={theme}>{tr("extensions.noneInstalled")}</Empty>
            ) : (
              <div role="list" style={{ display: "grid", gap: 10 }}>
                {installed.map(renderCard)}
              </div>
            )}
          </Section>

          <Section theme={theme} title={tr("extensions.availableHeading")}>
            {available.length === 0 ? (
              <Empty theme={theme}>{tr("extensions.noneAvailable")}</Empty>
            ) : (
              <div role="list" style={{ display: "grid", gap: 10 }}>
                {available.map(renderCard)}
              </div>
            )}
          </Section>

          <Section theme={theme} title={tr("extensions.reposHeading")}>
            <RepoList
              theme={theme}
              repos={data.repos}
              contents={data.contents}
              catalog={data.catalog}
              officialRepoUrl={deps.officialRepoUrl}
              onAdd={addRepo}
              onRemove={removeRepo}
            />
          </Section>
        </>
      )}

      <AnimatedDialog
        open={pendingRemove !== null}
        onScrimClick={() => setPendingRemove(null)}
      >
        {pendingRemove && (
          <ConfirmDialog
            theme={theme}
            title={tr("extensions.removeTitle", { name: pendingRemove.name })}
            message={tr("extensions.removeBody")}
            confirmLabel={tr("extensions.remove")}
            cancelLabel={tr("common.cancel")}
            confirmVariant="destructive"
            onConfirm={() => void removeExtension(pendingRemove)}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatedDialog>

      <AnimatedDialog open={trustOpen} onScrimClick={() => settleTrust(false)}>
        <ConfirmDialog
          theme={theme}
          title={tr("extensions.trustTitle")}
          message={tr("extensions.trustBody")}
          confirmLabel={tr("extensions.trustConfirm")}
          cancelLabel={tr("common.cancel")}
          confirmVariant="primary"
          onConfirm={() => settleTrust(true)}
          onCancel={() => settleTrust(false)}
        />
      </AnimatedDialog>
    </div>
  );
}

function Section({
  theme,
  title,
  children,
}: {
  theme: Theme;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3
        style={{
          margin: "0 0 12px 0",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: theme.muted,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        lineHeight: 1.5,
        color: theme.muted,
      }}
    >
      {children}
    </p>
  );
}
