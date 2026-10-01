import rawNotes, { appVersion, images } from "virtual:whats-new";
import { useI18n } from "../../i18n/useI18n";
import { parseReleaseNotes } from "../../store/releaseNotes";
import type { Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { MobileSheet } from "../MobileSheet";
import { NotesView } from "./NotesView";
import { StoryPages } from "./StoryPages";

// The bundled value is raw JSON: validate it once, and only trust it when it
// describes the version actually running.
const parsed = parseReleaseNotes(rawNotes);
export const bundledNotes =
  parsed && parsed.version === appVersion ? parsed : null;

const imageUrl = (n: string) => images[n];

/** Big release (stories) → full-screen pages; otherwise → a short sheet. */
export function WhatsNewAfterUpdate({
  theme,
  open,
  onClose,
}: {
  theme: Theme;
  open: boolean;
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const notes = bundledNotes;
  if (!notes) return null;
  if (notes.stories?.length) {
    return open ? (
      <StoryPages
        notes={notes}
        theme={theme}
        imageUrl={imageUrl}
        onDone={onClose}
      />
    ) : null;
  }
  return (
    <MobileSheet
      theme={theme}
      open={open}
      onClose={onClose}
      height="70%"
      label={tr("whatsNew.title", { v: notes.version })}
    >
      <div style={{ padding: "4px 20px 20px" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 19, fontWeight: 600 }}>
          {tr("whatsNew.title", { v: notes.version })}
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: theme.muted }}>
          {tr("whatsNew.now", { v: notes.version })}
        </p>
        <NotesView notes={notes} theme={theme} imageUrl={imageUrl} />
        <div style={{ marginTop: 16 }}>
          <Button theme={theme} variant="primary" fullWidth onClick={onClose}>
            {tr("whatsNew.gotIt")}
          </Button>
        </div>
      </div>
    </MobileSheet>
  );
}
