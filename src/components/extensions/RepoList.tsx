// The repositories half of the Extensions manager: which catalogues the
// app checks, how fresh each one is, and the add-by-URL form.
//
// Two rules this component exists to express:
//
//   - A repo that could not be reached is that ROW's problem, not the
//     view's. It shows as stale with its last-checked time and everything
//     else stays listed.
//   - Removing a repo does not uninstall anything. The confirm names the
//     installed extensions that came from it and says they keep working,
//     because "remove" is otherwise the scariest word on the screen.
//
// The trust notice is NOT here: it gates `onAdd`, which the view owns,
// because whether it has already been acknowledged is a stored fact.

import { useState } from "react";
import type { CatalogEntry } from "../../extensions/catalog";
import type { RepoEntry, RepoIndexEntry } from "../../extensions/repos";
import { formatNum } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import { FONT_STACKS, type Theme } from "../../styles/tokens";
import { AnimatedDialog } from "../AnimatedDialog";
import { Button } from "../Button";
import { ConfirmDialog } from "../ConfirmDialog";
import { Icon } from "../Icon";

export interface RepoContent {
  repoUrl: string;
  entries: RepoIndexEntry[];
  cached: boolean;
  fetchedAt?: string;
  error?: string;
}

/** "cancelled" means the user backed out of the trust notice — the field
 *  keeps what they typed so a second Add needs no retyping. */
export type AddOutcome = "added" | "cancelled";

interface Props {
  theme: Theme;
  repos: RepoEntry[];
  contents: RepoContent[];
  /** The whole catalogue, so a remove-confirm can name the extensions that
   *  came from the repo being removed. */
  catalog: CatalogEntry[];
  /** Marked with a badge, and removable like any other — which is what the
   *  spec says and what repos.ts's seed comment says. It used to be refused
   *  removal on the grounds that the bundled sources came from it; nothing
   *  is bundled any more, every source is installed from a repository, and
   *  a repo the user cannot remove is the one row in this list that does
   *  not do what the list says it does. Removing it does not uninstall
   *  anything — the confirm dialog says so by name. */
  officialRepoUrl: string;
  onAdd: (url: string) => Promise<AddOutcome>;
  onRemove: (url: string) => Promise<void>;
}

const ACTION_STYLE = { minHeight: 44, minWidth: 44, paddingInline: 14 };

/** A repo URL the app will actually fetch, or null. Rejects anything that
 *  is not an absolute http(s) URL — including `javascript:`, which parses
 *  perfectly well and must never reach `source_fetch`. */
export function parseRepoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RepoList({
  theme,
  repos,
  contents,
  catalog,
  officialRepoUrl,
  onAdd,
  onRemove,
}: Props) {
  const { locale, tr } = useI18n();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RepoEntry | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<Record<string, string>>({});

  const contentFor = (repoUrl: string) =>
    contents.find((c) => c.repoUrl === repoUrl);

  // Installed extensions whose origin is this repo — matched on the
  // recorded origin, not on who happens to list the id today.
  const installedFrom = (repoUrl: string) =>
    catalog
      .filter((c) => c.installed && c.record?.origin.repoUrl === repoUrl)
      .map((c) => c.name);

  // Validated on submit and on blur, never per keystroke: an error that
  // appears while you are still typing the scheme is noise.
  const validate = (): string | null => {
    const parsed = parseRepoUrl(url);
    setUrlError(parsed ? null : tr("extensions.repoUrlInvalid"));
    return parsed;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = validate();
    if (!parsed) return;
    setAddError(null);
    setAdding(true);
    try {
      if ((await onAdd(parsed)) === "added") setUrl("");
    } catch (err) {
      setAddError(tr("extensions.repoAddFailed", { error: errorText(err) }));
    } finally {
      setAdding(false);
    }
  }

  async function confirmRemove(repo: RepoEntry) {
    setPendingRemove(null);
    setRemoving(repo.url);
    setRemoveError(({ [repo.url]: _dropped, ...rest }) => rest);
    try {
      await onRemove(repo.url);
    } catch (err) {
      setRemoveError((prev) => ({
        ...prev,
        [repo.url]: tr("extensions.repoRemoveFailed", {
          error: errorText(err),
        }),
      }));
    } finally {
      setRemoving(null);
    }
  }

  const pendingNames = pendingRemove ? installedFrom(pendingRemove.url) : [];

  return (
    <div>
      {repos.length === 0 ? (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 13,
            lineHeight: 1.5,
            color: theme.muted,
          }}
        >
          {tr("extensions.noRepos")}
        </p>
      ) : (
        <div
          role="list"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 24,
          }}
        >
          {repos.map((repo) => {
            const content = contentFor(repo.url);
            const official = repo.url === officialRepoUrl;
            const count = content?.entries.length ?? 0;
            return (
              <div
                key={repo.url}
                role="listitem"
                data-testid={`repo-row-${repo.url}`}
                style={{
                  background: theme.chrome,
                  border: `0.5px solid ${theme.rule}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    minHeight: 56,
                  }}
                >
                  <div style={{ minWidth: 160, flex: 1 }}>
                    <div
                      title={repo.name}
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {repo.name}
                    </div>
                    <div
                      title={repo.url}
                      style={{
                        fontSize: 12,
                        color: theme.muted,
                        marginTop: 2,
                        // Wraps rather than truncating: `title` is a hover
                        // tooltip and there is no hover on Android, so an
                        // ellipsis would make the URL of a repo the user is
                        // about to trust — or remove — unrecoverable on the
                        // platform where it matters most. Two lines is the
                        // ceiling; `anywhere` lets a long path break.
                        overflowWrap: "anywhere",
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2,
                        overflow: "hidden",
                      }}
                    >
                      {/* The URL is an LTR run inside a line that follows
                          the UI direction, so it stays beside the repo's
                          name rather than jumping to the far edge. */}
                      <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                        {repo.url}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: theme.muted,
                        marginTop: 4,
                      }}
                    >
                      {count === 0
                        ? tr("extensions.repoEmpty")
                        : tr(
                            count === 1
                              ? "extensions.repoCountOne"
                              : "extensions.repoCountOther",
                            { n: formatNum(count, locale) },
                          )}
                      {" · "}
                      {repo.lastFetchedAt
                        ? tr("extensions.repoLastChecked", {
                            when: formatWhen(repo.lastFetchedAt, locale),
                          })
                        : tr("extensions.repoNeverChecked")}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginInlineStart: "auto",
                      flexShrink: 0,
                    }}
                  >
                    {official && (
                      // Informational only. It says where this row came
                      // from, not that it is privileged: Remove sits beside
                      // it exactly as it does on every other row.
                      <span
                        style={{
                          fontSize: 12,
                          color: theme.muted,
                          border: `0.5px solid ${theme.rule}`,
                          borderRadius: 999,
                          padding: "5px 10px",
                        }}
                      >
                        {tr("extensions.repoOfficialBadge")}
                      </span>
                    )}
                    <Button
                      theme={theme}
                      variant="destructiveGhost"
                      size="sm"
                      style={ACTION_STYLE}
                      loading={removing === repo.url}
                      disabled={removing !== null}
                      onClick={() => setPendingRemove(repo)}
                    >
                      {tr("extensions.remove")}
                    </Button>
                  </div>
                </div>
                {(content?.error ||
                  content?.cached ||
                  removeError[repo.url]) && (
                  // A merely-cached repo is working, just offline — its last
                  // good index is being served. That is a status, not an
                  // alert: two cached repos would otherwise fire two
                  // assertive announcements on every visit, and the danger
                  // tint would claim something is wrong when nothing is.
                  // `alert` and the danger colour stay for the arms that
                  // really did fail.
                  <div
                    role={
                      content?.error || removeError[repo.url]
                        ? "alert"
                        : "status"
                    }
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      marginTop: 10,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color:
                        content?.error || removeError[repo.url]
                          ? theme.danger
                          : theme.muted,
                    }}
                  >
                    <Icon
                      name="info"
                      size={14}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <span>
                      {removeError[repo.url] ??
                        (content?.cached
                          ? tr("extensions.repoStale")
                          : tr("extensions.repoUnreachable", {
                              error: content?.error ?? "",
                            }))}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={submit} style={{ fontFamily: FONT_STACKS.sans }}>
        <label
          htmlFor="extensions-repo-url"
          style={{
            display: "block",
            fontSize: 12,
            color: theme.muted,
            marginBottom: 6,
          }}
        >
          {tr("extensions.repoAddLabel")}
        </label>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            id="extensions-repo-url"
            type="url"
            dir="ltr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (url.trim()) validate();
            }}
            placeholder={tr("extensions.repoAddPlaceholder")}
            aria-invalid={urlError ? true : undefined}
            style={{
              flex: 1,
              minWidth: 200,
              minHeight: 44,
              boxSizing: "border-box",
              background: theme.bg,
              border: `1px solid ${urlError ? theme.danger : theme.rule}`,
              borderRadius: 10,
              padding: "10px 12px",
              font: "inherit",
              fontSize: 13,
              color: theme.ink,
              textAlign: "start",
            }}
          />
          <Button
            theme={theme}
            type="submit"
            variant="primary"
            size="sm"
            style={ACTION_STYLE}
            loading={adding}
            disabled={adding}
          >
            {tr("extensions.repoAdd")}
          </Button>
        </div>
        {(urlError || addError) && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.5,
              color: theme.danger,
            }}
          >
            <Icon
              name="info"
              size={14}
              style={{ flexShrink: 0, marginTop: 2 }}
            />
            <span>{urlError ?? addError}</span>
          </div>
        )}
      </form>

      <AnimatedDialog
        open={pendingRemove !== null}
        onScrimClick={() => setPendingRemove(null)}
      >
        {pendingRemove && (
          <ConfirmDialog
            theme={theme}
            title={tr("extensions.repoRemoveTitle", {
              name: pendingRemove.name,
            })}
            message={
              pendingNames.length > 0
                ? tr(
                    pendingNames.length === 1
                      ? "extensions.repoRemoveBodyOne"
                      : "extensions.repoRemoveBodyOther",
                    {
                      names: pendingNames.join(tr("extensions.listSeparator")),
                    },
                  )
                : tr("extensions.repoRemoveBodyNone")
            }
            confirmLabel={tr("extensions.remove")}
            cancelLabel={tr("common.cancel")}
            confirmVariant="destructive"
            onConfirm={() => void confirmRemove(pendingRemove)}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatedDialog>
    </div>
  );
}

/** Absolute date + time rather than "3 hours ago": staleness only matters
 *  when a repo is unreachable, and then the user wants to know how old the
 *  copy they are looking at actually is. */
function formatWhen(iso: string, locale: "en" | "ar"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return d.toISOString();
  }
}
