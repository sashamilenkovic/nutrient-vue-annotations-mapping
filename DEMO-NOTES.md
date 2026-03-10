# Demo Notes — Annotation Mapping Q&A

Notes on each demo section, what the customer asked, and what to show.

---

## 1. Redaction

**Question:** They can't store multiple rectangles. They thought redaction was based on `pspdfkit/markup/highlight` (multi-rect). Asked if `pspdfkit/shape/rectangle` could be used for redaction instead.

**Answer:** Area redaction creates `pspdfkit/markup/redaction` — its own type, not highlight, not rectangle. The area tool always produces **exactly one rect** in the `rects` array.

**Demo flow:**
1. Click "Area Redaction Tool" → draw a rectangle on the document
2. Check DB → `records.content` has `"rects": [[left, top, width, height]]` — single rect
3. **Do NOT click "Apply Redactions"** — applying permanently burns the content out of the PDF and deletes the annotation. The annotation data only exists *before* applying.

**DB proof:** `records` table → `content` column → `"type": "pspdfkit/markup/redaction"`, `"rects": [[78.82, 48.01, 295.27, 58.37]]`

**Implementation:**
- Buttons call `setInteractionMode('REDACT_SHAPE_RECTANGLE')` / `setInteractionMode('REDACT_TEXT_HIGHLIGHTER')` which sets the viewer's `interactionMode` via `inst.setViewState()`
- No toolbar customization needed — the built-in redaction tools work as-is
- Area redaction always produces a single rect in the `rects` array (the customer's concern about multi-rect was unfounded for this annotation type)

---

## 2. Stamps

**Question:** `pspdfkit/stamp` is limited — missing font definitions, multiline text, and images in stamps.

**Answer:** Correct. `pspdfkit/stamp` only supports `title`, `subtitle`, `color`. For rich stamps, render the desired appearance to an image (canvas) and register it as an `ImageAnnotation` via `setStampAnnotationTemplates()`. Image stamps serialize as `pspdfkit/image`, not `pspdfkit/stamp` — their mapping layer needs to handle both types.

**Demo flow:**
1. **Built-in stamps:** Click "Open Stamp Picker" → choose a predefined stamp → export to see `pspdfkit/stamp` with title/subtitle/color
2. **Image stamps:** Click "Register Image Stamp" → pick an image file → it's added to the stamp picker as an `ImageAnnotation` via `setStampAnnotationTemplates()`
3. **Custom text stamps (multiline + fonts + images):** Fill in the text stamp form:
   - Multiline text (e.g. `APPROVED\nQuality Check`)
   - Font family (Arial, Georgia, Courier, Times, Verdana, Impact)
   - Font size (18–64px)
   - Color picker
   - Optional background image (renders image on left, text on right)
   - Click "Register Text Stamp" → renders to a high-DPI canvas (3x scale), converts to PNG, registers as `ImageAnnotation`
4. Open Stamp Picker → place the custom stamp on the document
5. Check DB → `records.content` has `pspdfkit/image` with `imageAttachmentId`

**Implementation:**
- **Built-in stamps:** `setInteractionMode('STAMP_PICKER')` opens the native stamp picker UI
- **Image stamps:** User picks a file → `inst.createAttachment(file)` uploads it and returns an `attachmentId` → a new `SDK.Annotations.ImageAnnotation` is created with that `imageAttachmentId` → registered via `inst.setStampAnnotationTemplates()` which pushes it into the picker
- **Custom text stamps:** `renderTextToBlob()` draws text onto a `<canvas>` at 3x scale (for high-DPI), with configurable font, size, color, and optional image alongside. Canvas is converted to PNG blob → uploaded as attachment → registered as `ImageAnnotation` same as above
- Both image and text stamps serialize as `pspdfkit/image` (not `pspdfkit/stamp`) — Doxis mapping layer needs to handle both types

---

## 3. Arrow

**Question:** Can they limit `pspdfkit/shape/line` to only `openArrow` end caps? Other tools should be deactivated.

**Answer:** Yes. Set `LINE_CAP_PRESETS` to restrict options, use `annotationToolbarItems` to hide controls.

**Demo flow:**
1. Click "Arrow Tool (openArrow only)" → draw a line on the document
2. Line cap is forced to `openArrow` via `setAnnotationPresets` and `LINE_CAP_PRESETS`
3. Toolbar only shows delete — all other controls (stroke-color, line-width, line caps, dash array) are hidden via `annotationToolbarItems`
4. Check DB → `records.content` has `"lineCaps": { "start": null, "end": "openArrow" }`

**Implementation (three layers of restriction):**
1. **`SDK.Options.LINE_CAP_PRESETS = ['openArrow']`** — set via `beforeLoad` callback *before* `SDK.load()` (Options is frozen after load). This removes all other cap options (including "none") from any line cap picker in the UI.
2. **`inst.setAnnotationPresets()`** — forces `lineCaps: { start: null, end: 'openArrow' }` on both `line` and `arrow` presets, so every new line annotation defaults to openArrow.
3. **`inst.setToolbarItems()`** — removes the `line` type from the main toolbar (keeps `arrow`), so users can't create a plain line.
4. **`inst.setAnnotationToolbarItems()`** — for `LineAnnotation`, filters the secondary toolbar to only show `delete`. All other controls (stroke-color, line-width, line caps, dash array) are hidden.

All of this is configured once in `onViewerLoaded()` and `restrictLineCaps()` — no per-click setup needed.

---

## 4. Ink (Line Overlay)

**Question:** They need the bounding box from the ink annotation. Need to deactivate other tools.

**Answer:** Bounding box is already stored in the DB `content` column via the `bbox` field — no reconstruction needed. Toolbar restricted to stroke-color, line-width, delete via `annotationToolbarItems`.

**Demo flow:**
1. Click "Ink Drawing Tool" → draw freehand on the document
2. Toolbar is restricted to stroke-color, line-width, delete
3. Check DB → `records.content` has `bbox`, `lines.points`, `strokeColor`, `lineWidth` — all stored automatically

**Implementation:**
- Button sets `interactionMode` to `SDK.InteractionMode.INK`
- `inst.setAnnotationToolbarItems()` checks `annotation instanceof SDK.Annotations.InkAnnotation` and filters to only `['stroke-color', 'line-width', 'delete', 'spacer']`
- The `bbox` field in the DB is computed automatically by the SDK from the drawn points — Doxis does not need to reconstruct it

---

## 5. Marker (Rectangle Overlay)

**Question:** Want to use `pspdfkit/shape/rectangle` instead of `pspdfkit/markup/highlight` because highlight stores multiple rects from text selection. Border and fill color should be the same, with transparency.

**Answer:** Yes, `pspdfkit/shape/rectangle` uses a single `boundingBox` — no multi-rect problem. Rectangle preset is configured with matching `strokeColor`/`fillColor` + `opacity: 0.3` to create a translucent marker overlay effect.

**Demo flow:**
1. Click "Rectangle Tool" → draw a rectangle — appears as a translucent yellow overlay
2. Text underneath remains visible through the opacity
3. Check DB → `records.content` has single `boundingBox` (not multiple `rects`), matching `strokeColor`/`fillColor`, and `opacity`

**Implementation:**
- `inst.setAnnotationPresets()` sets the `rectangle` preset with matching `strokeColor` and `fillColor` (yellow) + `opacity: 0.3`, so every new rectangle looks like a marker overlay
- `inst.setCurrentAnnotationPreset('rectangle')` ensures the preset is active when the tool is activated
- `inst.setAnnotationToolbarItems()` checks `annotation instanceof SDK.Annotations.RectangleAnnotation` and filters to only `['fill-color', 'opacity', 'delete', 'spacer']` — stroke-color is hidden since it should always match fill
- Stores as `pspdfkit/shape/rectangle` with a single `boundingBox` — unlike `pspdfkit/markup/highlight` which uses a `rects` array (one rect per text line selected)

---

## 6. Custom Fields (CreatedBy / ModifiedBy)

**Question:** All their annotations need CreatedBy/ModifiedBy fields. No equivalent in Instant JSON.

**Answer:** Use `customData` for arbitrary JSON key-value pairs + `creatorName`. Both persist through Instant JSON and Document Engine.

**Demo flow:**
1. Click "Create with Custom Data" → programmatically creates annotation with `customData: { CreatedBy, ModifiedBy }`
2. Check DB → `records.content` has `customData` and `creatorName`

**Implementation:**
- `createAnnotationWithCustomData()` in `useAnnotations.ts` creates a `RectangleAnnotation` programmatically (no drawing tool)
- Passes `customData: { CreatedBy: 'Jane Smith', ModifiedBy: 'John Doe', department: 'Legal' }` and `creatorName: 'Jane Smith'` directly to the annotation constructor
- Both fields are first-class in Instant JSON — `customData` is an arbitrary JSON object, `creatorName` is a top-level string field
- Document Engine persists both in the `records.content` JSONB column without any extra configuration

---

## General Notes

- **Coordinates:** All positions in PDF points at **72 DPI** (ISO 32000 standard)
- **Instant sync:** With `instant: true`, annotations sync to Document Engine in real-time. All annotation data is available in the DB `records.content` column.
- **DB location:** `records` table, `content` JSONB column. Filter by `content->>'type'` for specific annotation types.
- **TablePlus connection:** host `127.0.0.1`, port `5433`, user `db-user`, password `password`, database `document-engine`
