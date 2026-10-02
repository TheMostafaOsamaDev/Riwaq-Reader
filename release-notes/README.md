# Release Notes

Hand-written, bilingual (English and Arabic) "What's new" notes for each release.

## How to create a release notes file

1. Create a JSON file named `<version>.json` (e.g., `0.6.0.json`)
2. Write the file in UTF-8 with one changelog entry per item
3. Use the product's voice, not PR titles
4. All text must be bilingual: every field has both `en` and `ar`

## Rules

- **`version`**: must match the filename (e.g., `"0.6.0"`)
- **`date`**: release date in `YYYY-MM-DD` format
- **`highlight`** (optional): a featured card with `image`, `title`, `body`
- **`stories`** (optional): omit for small releases; array of `{ kind, image, title, body }`
- **`items`**: at least one change; array of `{ kind, en, ar }`
- **`kind`**: one of `new`, `improved`, `fixed`

## Image rules

- Format: WebP only
- Filename: `^[A-Za-z0-9_.-]+\.webp$`
- Size: ≤ 150 KB (153,600 bytes)
- Location: `release-notes/img/`

## Example

```json
{
  "version": "0.6.0",
  "date": "2026-10-15",
  "highlight": {
    "image": "0.6.0-cards.webp",
    "title": { "en": "Make the library yours", "ar": "اجعل المكتبة على ذوقك" },
    "body": { "en": "Four styles.", "ar": "أربعة أنماط." }
  },
  "items": [
    { "kind": "new", "en": "Updates install inside the app", "ar": "التحديثات داخل التطبيق" },
    { "kind": "fixed", "en": "No double import", "ar": "لا استيراد مزدوج" }
  ]
}
```
