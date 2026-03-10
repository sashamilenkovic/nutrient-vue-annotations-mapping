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

---

## 3. Arrow

**Question:** Can they limit `pspdfkit/shape/line` to only `openArrow` end caps? Other tools should be deactivated.

**Answer:** Yes. Set `LINE_CAP_PRESETS` to restrict options, use `annotationToolbarItems` to hide controls.

**Demo flow:**
1. Click "Arrow Tool (openArrow only)" → draw a line on the document
2. Line cap is forced to `openArrow` via `setAnnotationPresets` and `LINE_CAP_PRESETS`
3. Toolbar only shows delete — all other controls (stroke-color, line-width, line caps, dash array) are hidden via `annotationToolbarItems`
4. Check DB → `records.content` has `"lineCaps": { "start": null, "end": "openArrow" }`

---

## 4. Ink (Line Overlay)

**Question:** They need the bounding box from the ink annotation. Need to deactivate other tools.

**Answer:** Bounding box is already stored in the DB `content` column via the `bbox` field — no reconstruction needed. Toolbar restricted to stroke-color, line-width, delete via `annotationToolbarItems`.

**Demo flow:**
1. Click "Ink Drawing Tool" → draw freehand on the document
2. Toolbar is restricted to stroke-color, line-width, delete
3. Check DB → `records.content` has `bbox`, `lines.points`, `strokeColor`, `lineWidth` — all stored automatically

---

## 5. Marker (Rectangle Overlay)

**Question:** Want to use `pspdfkit/shape/rectangle` instead of `pspdfkit/markup/highlight` because highlight stores multiple rects from text selection.

**Answer:** Yes, `pspdfkit/shape/rectangle` uses a single `boundingBox` — no multi-rect problem. Set same fill/stroke color + opacity for highlight-like appearance.

**Demo flow:**
1. Click "Rectangle Tool" → draw a rectangle
2. Check DB → `records.content` has single `boundingBox` (not multiple `rects`)
3. Compare with highlight which would have `rects: [...]` array

---

## 6. Custom Fields (CreatedBy / ModifiedBy)

**Question:** All their annotations need CreatedBy/ModifiedBy fields. No equivalent in Instant JSON.

**Answer:** Use `customData` for arbitrary JSON key-value pairs + `creatorName`. Both persist through Instant JSON and Document Engine.

**Demo flow:**
1. Click "Create with Custom Data" → programmatically creates annotation with `customData: { CreatedBy, ModifiedBy }`
2. Check DB → `records.content` has `customData` and `creatorName`

---

## General Notes

- **Coordinates:** All positions in PDF points at **72 DPI** (ISO 32000 standard)
- **Instant sync:** With `instant: true`, annotations sync to Document Engine in real-time. All annotation data is available in the DB `records.content` column.
- **DB location:** `records` table, `content` JSONB column. Filter by `content->>'type'` for specific annotation types.
- **TablePlus connection:** host `127.0.0.1`, port `5433`, user `db-user`, password `password`, database `document-engine`
