# Release notes

One hand-written file per release, `<version>.json`, in English and Arabic.
It is the only source: the update sheet before you update, the "What's new"
screen after, Settings → About, and the GitHub release body all come from it.
A stable release will not build without it.

## The house style

**A picture for every big feature. One line for everything else.**

Decided 2026-10-02, after comparing three styles against a real release.

| Part | How many | What it is |
|---|---|---|
| `highlight` | exactly 1 | The single biggest thing in the release. Image, title, two sentences. |
| `stories` | 0–3 | Each remaining feature worth showing. Image, title, one or two sentences. |
| `items` | everything else | One tagged line each: `new`, `improved` or `fixed`. |

**Deciding between a story and an item.** Ask: *would a reader who already
has the app want to go and try this?* If yes, it is a story and it gets a
picture. If it is something they will simply notice working better, or never
notice at all, it is an item. A sidebar that no longer shakes is an item. The
ability to read Word files is a story.

**Cap stories at three.** On the phone they become a tour, one full screen per
story, shown once after updating. Four is where a tour stops feeling like a
welcome and starts feeling like an ad.

**Small releases omit `stories` entirely.** A bug-fix release gets the
highlight and the list, and the phone then shows a short sheet instead of a
tour. Do not invent a story to fill the shape.

**If nothing in a release deserves a picture**, drop `highlight` too and ship
just the list. The UI handles it; a release with no images still reads fine.

### Writing the text

- **Say what changed for the reader, never what changed in the code.** Not
  "refactor the import pipeline" — "books you open from another app now import
  in the background".
- **Never paste a PR title.** Those are written for the person merging them.
- **Two sentences is the ceiling** for a highlight or a story. The first says
  what it is, the second says where to find it or why it matters.
- **One line is the ceiling** for an item, and it should read as a whole
  thought, not a fragment.
- **Both languages, always.** The validator rejects a missing or
  English-looking Arabic string, because a half-translated release is worse
  than an untranslated one.

### What the pictures should show

The app doing the thing, cropped tight. A reader should recognise the screen
they are about to see. Avoid full-window screenshots at this size — by the
time they are scaled into a phone sheet, nothing in them is legible.

## Where each language goes

The notes file is written in **both** languages, always. Where they end up
differs, and this is settled — do not re-decide it per release:

| Artifact | Languages |
|---|---|
| The **GitHub release body** (`render-release-notes.mjs`) | **English only.** |
| The in-app What's new sheet (`whats-new.json`) | English and Arabic. |
| `fastlane/.../changelogs/<versionCode>.txt` | One file per language, as the stores expect. |

The release page is not where an Arabic reader reads the notes — the app is,
in an interface already in their language. A second copy of every line on
GitHub only made the body twice as long to scroll. So `ar` stays required in
the JSON: dropping it would take Arabic out of the app, which is not the point.

## The file

- **`version`** — must match the filename.
- **`date`** — `YYYY-MM-DD`.
- **`highlight`** *(optional)* — `{ image?, title, body }`.
- **`stories`** *(optional)* — `[{ kind, image?, title, body }]`. Omit it
  entirely rather than passing an empty array.
- **`items`** — at least one `{ kind, en, ar }`.
- **`kind`** — `new`, `improved` or `fixed`.
- **`installNote`** *(optional, and rare)* — `{ en, ar }`. Goes at the top of
  the GitHub release body, above everything, and **nowhere else**: the app's
  parser ignores it.

`title` and `body` are both `{ en, ar }`.

### `installNote`, and when to use it

Only when a copy people already have **cannot reach this release on its own**,
so the only way they find out is by reading the releases page. 0.6.0 is the
case it was added for: every build up to 0.5.1 has an update check broken by
CORS and will never offer anything, so those users have to install one release
by hand before updates start working.

It is deliberately not shown in the app. Everyone who sees the in-app sheet has
already updated — telling them to install by hand is noise at best.

### Images

WebP, in `release-notes/img/`, at most 150 KB each, named
`^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.webp$` — no leading dot. They are bundled into
the build, so an oversized one costs every user who downloads the update.

### Checking it

```sh
pnpm verify:notes                 # every notes file in the repo
pnpm verify:notes --require 0.6.0 # …and 0.6.0's must exist (what the release runs)
```

`pnpm check` runs the first form. The release workflow runs the second on a
stable tag and fails without it. Prereleases (`v0.6.0-rc1`) are exempt: they
are never served to anyone's updater.

## Example

```json
{
  "version": "0.6.0",
  "date": "2026-10-15",
  "highlight": {
    "image": "0.6.0-updates.webp",
    "title": { "en": "Riwaq updates itself", "ar": "رواق يحدّث نفسه" },
    "body": {
      "en": "When a new version is out, Riwaq shows you what changed and installs it — on Android too.",
      "ar": "عند صدور إصدار جديد يعرض لك رواق ما تغيّر ويثبّته — على أندرويد أيضًا."
    }
  },
  "stories": [
    {
      "kind": "new",
      "image": "0.6.0-docx.webp",
      "title": { "en": "Read Word files like books", "ar": "اقرأ ملفات Word ككتب" },
      "body": {
        "en": "A DOCX opens as flowing text or page-for-page, and your highlights follow you between the two.",
        "ar": "يفتح ملف DOCX كنص متدفق أو صفحة بصفحة، وتنتقل تظليلاتك معك بين الوضعين."
      }
    }
  ],
  "items": [
    {
      "kind": "improved",
      "en": "Files opened from other apps import in the background",
      "ar": "الملفات المفتوحة من تطبيقات أخرى تُستورد في الخلفية"
    },
    {
      "kind": "fixed",
      "en": "Your place survives a layout switch",
      "ar": "يبقى موضعك عند تغيّر التخطيط"
    }
  ]
}
```
