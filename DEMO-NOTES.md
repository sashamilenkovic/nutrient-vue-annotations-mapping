# Demo Notes — Annotation Mapping Q&A

Notes on each demo section, what the customer asked, and what to show.

---

## 1. Redaction

**Question:** They can't store multiple rectangles. They thought redaction was based on `pspdfkit/markup/highlight` (multi-rect). Asked if `pspdfkit/shape/rectangle` could be used for redaction instead.

**Answer:** Area redaction creates `pspdfkit/markup/redaction` — its own type, not highlight, not rectangle. The area tool always produces **exactly one rect** in the `rects` array.

**Demo flow:**
1. Click "Area Redaction Tool" → draw a rectangle on the document
2. Click "Export Annotations" → see the JSON with `"rects": [[left, top, width, height]]` — single rect
3. **Do NOT click "Apply Redactions"** — applying permanently burns the content out of the PDF and deletes the annotation. The annotation data only exists *before* applying.

**DB proof:** `records` table → `content` column → `"type": "pspdfkit/markup/redaction"`, `"rects": [[78.82, 48.01, 295.27, 58.37]]`

---

## 2. Stamps

**Question:** `pspdfkit/stamp` is limited — missing font definitions, multiline text, and images in stamps.

**Answer:** Correct. `pspdfkit/stamp` only supports `title`, `subtitle`, `color`. For images, use `ImageAnnotation` + `setStampAnnotationTemplates()`. Image stamps serialize as `pspdfkit/image`, not `pspdfkit/stamp` — their mapping layer needs to handle both types.

**Demo flow:**
1. Click "Open Stamp Picker" → choose a predefined stamp
2. Export annotations → see `pspdfkit/stamp` with title/subtitle/color
3. For image stamps: would need to add `setStampAnnotationTemplates()` with an `ImageAnnotation`

---

## 3. Arrow

**Question:** Can they limit `pspdfkit/shape/line` to only `openArrow` end caps? Other tools should be deactivated.

**Answer:** Yes. Set `LINE_CAP_PRESETS` to restrict options, use `annotationToolbarItems` to hide controls.

**Demo flow:**
1. Click "Arrow / Line Tool" → draw a line on the document
2. The line can have `lineCaps: { end: 'openArrow' }` set
3. Toggle "Toolbar Limiting" to see restricted toolbar items

---

## 4. Ink (Line Overlay)

**Question:** They need to reconstruct the bounding box from Instant JSON `lines` data. Need to deactivate other tools.

**Answer:** Bounding box = `min/max of all points ± lineWidth/2`. Straightforward to reconstruct. Toolbar limiting via `annotationToolbarItems`.

**Demo flow:**
1. Click "Ink Drawing Tool" → draw freehand on the document
2. Export annotations → see `lines` array with drawing points and `boundingBox`
3. Toggle "Toolbar Limiting" → ink toolbar restricted to stroke-color, line-width, delete

---

## 5. Marker (Rectangle Overlay)

**Question:** Want to use `pspdfkit/shape/rectangle` instead of `pspdfkit/markup/highlight` because highlight stores multiple rects from text selection.

**Answer:** Yes, `pspdfkit/shape/rectangle` uses a single `boundingBox` — no multi-rect problem. Set same fill/stroke color + opacity for highlight-like appearance.

**Demo flow:**
1. Click "Rectangle Tool" → draw a rectangle
2. Export annotations → see single `boundingBox` (not multiple `rects`)
3. Compare with highlight which would have `rects: [...]` array

---

## 6. Toolbar Limiting

**Question:** Need to limit available tools for all annotation types.

**Answer:** `annotationToolbarItems` callback receives the annotation instance — customize per type.

**Demo flow:**
1. Create some annotations first (ink, line, rectangle)
2. Click "Enable Toolbar Limiting"
3. Select each annotation → see restricted toolbars:
   - Ink: stroke-color, line-width, delete
   - Line: stroke-color, delete
   - Rectangle: fill-color, opacity, delete

---

## 7. Custom Fields (CreatedBy / ModifiedBy)

**Question:** All their annotations need CreatedBy/ModifiedBy fields. No equivalent in Instant JSON.

**Answer:** Use `customData` for arbitrary JSON key-value pairs + `creatorName`. Both persist through Instant JSON and Document Engine.

**Demo flow:**
1. Click "Create with Custom Data" → programmatically creates annotation with `customData: { CreatedBy, ModifiedBy }`
2. Export annotations → see `customData` and `creatorName` in the JSON
3. Check DB → `records.content` has the custom fields

---

## General Notes

- **Coordinates:** All positions in PDF points at **72 DPI** (ISO 32000 standard)
- **Instant sync:** With `instant: true`, annotations sync to Document Engine in real-time. `exportInstantJSON()` only shows *unsaved changes* (usually empty). Use "Export Annotations" (`getAnnotations()`) to see full data.
- **DB location:** `records` table, `content` JSONB column. Filter by `content->>'type'` for specific annotation types.
- **TablePlus connection:** host `127.0.0.1`, port `5433`, user `db-user`, password `password`, database `document-engine`
