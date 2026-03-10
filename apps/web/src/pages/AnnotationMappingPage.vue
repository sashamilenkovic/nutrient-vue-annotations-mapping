<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Instance } from '@nutrient-sdk/viewer'
import type NutrientViewer from '@nutrient-sdk/viewer'
import { getNutrientViewer } from '@/nutrient'
import DocumentViewer from '@/components/DocumentViewer.vue'
import AnnotationDemo from '@/components/AnnotationDemo.vue'
import { useAnnotations } from '@/composables/useAnnotations'

const route = useRoute()
const router = useRouter()

const instance = ref<Instance | null>(null)
const documentId = ref<string>((route.query.documentId as string) || '')
const jsonOutput = ref<string>('')
const statusMessage = ref<string>('')

const {
  createAnnotationWithCustomData,
  exportInstantJSON,
} = useAnnotations(instance)

// Sync documentId to URL query params
watch(documentId, (id) => {
  const query = id ? { documentId: id } : {}
  router.replace({ query })
})

function restrictLineCaps(SDK: typeof NutrientViewer) {
  try {
    SDK.Options.LINE_CAP_PRESETS = ['openArrow']
  } catch {
    // Options is frozen after first SDK.load() — already set
  }
}

async function onViewerLoaded(inst: Instance) {
  instance.value = inst
  const SDK = await getNutrientViewer()

  // Remove plain "line" from toolbar — "arrow" (with openArrow forced) replaces it
  inst.setToolbarItems((items) =>
    items.filter((item) => item.type !== 'line'),
  )

  // Arrow: only show delete in secondary toolbar — cap is forced via presets
  inst.setAnnotationToolbarItems((annotation, { defaultAnnotationToolbarItems }) => {
    if (annotation instanceof SDK.Annotations.LineAnnotation) {
      return defaultAnnotationToolbarItems.filter(
        (item) => (item as { type?: string }).type === 'delete',
      )
    }
    return defaultAnnotationToolbarItems
  })

  // Force openArrow end cap on line/arrow presets,
  // and set rectangle preset to matching stroke/fill + opacity (marker overlay)
  const markerColor = new SDK.Color({ r: 255, g: 235, b: 59 }) // yellow
  inst.setAnnotationPresets((presets) => ({
    ...presets,
    line: {
      ...presets.line,
      lineCaps: { start: null, end: 'openArrow' },
    },
    arrow: {
      ...presets.arrow,
      lineCaps: { start: null, end: 'openArrow' },
    },
    rectangle: {
      ...presets.rectangle,
      strokeColor: markerColor,
      fillColor: markerColor,
      opacity: 0.3,
    },
  }))

  statusMessage.value = 'Document loaded successfully'
}

function showStatus(msg: string) {
  statusMessage.value = msg
  setTimeout(() => {
    if (statusMessage.value === msg) statusMessage.value = ''
  }, 3000)
}

// Upload document
async function uploadDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const formData = new FormData()
  formData.append('file', file)

  try {
    const res = await fetch('/api/documents', { method: 'POST', body: formData })
    const data = await res.json()
    if (data.documentId) {
      documentId.value = data.documentId
      showStatus(`Uploaded: ${file.name}`)
    }
  } catch (err) {
    showStatus(`Upload failed: ${err}`)
  }
}

// --- Tool activation helpers ---

async function setInteractionMode(mode: keyof typeof import('@nutrient-sdk/viewer').default.InteractionMode) {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }
  const SDK = await getNutrientViewer()
  inst.setViewState((vs) => vs.set('interactionMode', SDK.InteractionMode[mode]))
  showStatus('Tool activated — draw on the document')
}

// 1. Redaction — activate area redaction tool
function demoAreaRedaction() {
  setInteractionMode('REDACT_SHAPE_RECTANGLE')
}

function demoTextRedaction() {
  setInteractionMode('REDACT_TEXT_HIGHLIGHTER')
}

// 2. Stamps — activate stamp tool or register image stamp
function demoStamp() {
  setInteractionMode('STAMP_PICKER')
}

const imageStampInput = ref<HTMLInputElement | null>(null)

async function registerImageStamp(event: Event) {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }

  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  const SDK = await getNutrientViewer()
  const attachmentId = await inst.createAttachment(file)

  const imageAnnotation = new SDK.Annotations.ImageAnnotation({
    imageAttachmentId: attachmentId,
    contentType: file.type as 'image/png' | 'image/jpeg',
    description: file.name,
    boundingBox: new SDK.Geometry.Rect({ width: 300, height: 200, top: 0, left: 0 }),
  })

  inst.setStampAnnotationTemplates((templates) => {
    templates.push(imageAnnotation)
    return templates
  })

  showStatus(`Image stamp "${file.name}" added to picker — open Stamp Picker to use it`)

  // Reset input so the same file can be re-selected
  if (imageStampInput.value) imageStampInput.value.value = ''
}

// Text-to-image stamp with font control + optional image
const stampText = ref('APPROVED\nQuality Check')
const stampFontFamily = ref('Arial')
const stampFontSize = ref(32)
const stampColor = ref('#d32f2f')
const stampImageFile = ref<File | null>(null)
const stampImageInput = ref<HTMLInputElement | null>(null)

function onStampImageSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  stampImageFile.value = file ?? null
}

function clearStampImage() {
  stampImageFile.value = null
  if (stampImageInput.value) stampImageInput.value.value = ''
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function renderTextToBlob(
  text: string,
  font: string,
  size: number,
  color: string,
  imageFile?: File | null,
): Promise<Blob> {
  const scale = 3 // High-DPI for crisp rendering
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  const lines = text.split('\n')
  const scaledSize = size * scale
  const lineHeight = scaledSize * 1.3
  const padding = scaledSize * 0.4

  // Measure text dimensions
  ctx.font = `bold ${scaledSize}px "${font}", sans-serif`
  const textMaxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width))
  const textHeight = lineHeight * lines.length

  // Load optional background image
  let img: HTMLImageElement | null = null
  if (imageFile) {
    img = await loadImage(imageFile)
  }

  if (img) {
    // Image mode: image on the left, text to the right
    const imgGap = scaledSize * 0.4
    const imgDrawHeight = textHeight
    const imgDrawWidth = (img.naturalWidth / img.naturalHeight) * imgDrawHeight

    canvas.width = Math.ceil(imgDrawWidth + imgGap + textMaxWidth + padding * 2)
    canvas.height = Math.ceil(textHeight + padding * 2)

    ctx.drawImage(img, padding, padding, imgDrawWidth, imgDrawHeight)
    URL.revokeObjectURL(img.src)

    ctx.font = `bold ${scaledSize}px "${font}", sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'

    lines.forEach((line, i) => {
      ctx.fillText(line, padding + imgDrawWidth + imgGap, padding + i * lineHeight)
    })
  } else {
    // Text-only mode
    canvas.width = Math.ceil(textMaxWidth + padding * 2)
    canvas.height = Math.ceil(textHeight + padding * 2)

    ctx.font = `bold ${scaledSize}px "${font}", sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'

    lines.forEach((line, i) => {
      ctx.fillText(line, padding, padding + i * lineHeight)
    })
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/png')
  })
}

async function registerTextStamp() {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }
  if (!stampText.value.trim()) {
    showStatus('Enter stamp text')
    return
  }

  const SDK = await getNutrientViewer()
  const blob = await renderTextToBlob(stampText.value, stampFontFamily.value, stampFontSize.value, stampColor.value, stampImageFile.value)
  const file = new File([blob], 'text-stamp.png', { type: 'image/png' })
  const attachmentId = await inst.createAttachment(file)

  // Size the bounding box proportionally to the text
  const lines = stampText.value.split('\n')
  const height = Math.max(60, lines.length * stampFontSize.value * 1.3 + 20)
  const width = Math.max(200, stampFontSize.value * Math.max(...lines.map((l) => l.length)) * 0.7)

  const imageAnnotation = new SDK.Annotations.ImageAnnotation({
    imageAttachmentId: attachmentId,
    contentType: 'image/png',
    description: `Text stamp: ${stampText.value.replace(/\n/g, ' | ')}`,
    boundingBox: new SDK.Geometry.Rect({ width, height, top: 0, left: 0 }),
  })

  inst.setStampAnnotationTemplates((templates) => {
    templates.push(imageAnnotation)
    return templates
  })

  showStatus(`Text stamp added — open Stamp Picker to place it`)
}


// 4. Ink — activate ink drawing tool with limited toolbar
async function demoInk() {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }
  const SDK = await getNutrientViewer()

  // Limit ink toolbar to stroke-color, line-width, delete only
  inst.setAnnotationToolbarItems((annotation, { defaultAnnotationToolbarItems }) => {
    if (annotation instanceof SDK.Annotations.InkAnnotation) {
      return defaultAnnotationToolbarItems.filter(
        (item) => ['stroke-color', 'line-width', 'delete', 'spacer'].includes((item as { type?: string }).type ?? ''),
      )
    }
    return defaultAnnotationToolbarItems
  })

  inst.setViewState((vs) => vs.set('interactionMode', SDK.InteractionMode.INK))
  showStatus('Ink tool activated — toolbar: stroke-color, line-width, delete')
}

// 5. Rectangle (Marker Overlay) — fill-color, opacity, delete only
async function demoRectangle() {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }
  const SDK = await getNutrientViewer()

  // Limit rectangle toolbar to fill-color, opacity, delete
  inst.setAnnotationToolbarItems((annotation, { defaultAnnotationToolbarItems }) => {
    if (annotation instanceof SDK.Annotations.RectangleAnnotation) {
      return defaultAnnotationToolbarItems.filter(
        (item) => ['fill-color', 'opacity', 'delete', 'spacer'].includes((item as { type?: string }).type ?? ''),
      )
    }
    return defaultAnnotationToolbarItems
  })

  inst.setCurrentAnnotationPreset('rectangle')
  inst.setViewState((vs) => vs.set('interactionMode', SDK.InteractionMode.SHAPE_RECTANGLE))
  showStatus('Rectangle tool activated — toolbar: fill-color, opacity, delete')
}

// 7. Custom Data — programmatic (no drawing tool for this)
async function demoCustomData() {
  const result = await createAnnotationWithCustomData(
    0,
    { left: 50, top: 500, width: 200, height: 60 },
    { CreatedBy: 'Jane Smith', ModifiedBy: 'John Doe', department: 'Legal' },
    'Jane Smith',
  )
  if (result) {
    showStatus('Annotation with custom data created — export JSON to verify')
    const json = await exportInstantJSON()
    if (json) jsonOutput.value = JSON.stringify(json, null, 2)
  } else {
    showStatus('Load a document first')
  }
}


async function doExportInstantJSON() {
  const json = await exportInstantJSON()
  if (json) {
    jsonOutput.value = JSON.stringify(json, null, 2)
    showStatus('Instant JSON exported (changes only — annotations already synced may not appear)')
  } else {
    showStatus('No instance loaded')
  }
}

async function doExportAnnotations() {
  const inst = instance.value
  if (!inst) {
    showStatus('No instance loaded')
    return
  }

  const pageCount = inst.totalPageCount
  const allAnnotations: unknown[] = []

  for (let i = 0; i < pageCount; i++) {
    const annotations = await inst.getAnnotations(i)
    for (const ann of annotations) {
      allAnnotations.push(ann.toJSON())
    }
  }

  jsonOutput.value = JSON.stringify(allAnnotations, null, 2)
  showStatus(`Exported ${allAnnotations.length} annotation(s) across ${pageCount} page(s)`)
}
</script>

<template>
  <div class="page-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Annotation Demos</h2>
        <p class="sidebar-subtitle">Document Engine mode — each section demonstrates an annotation mapping question</p>
      </div>

      <div class="sidebar-controls">
        <label class="upload-btn">
          Upload Document (PDF/DOCX)
          <input ref="fileInput" type="file" accept=".pdf,.docx,.xlsx,.pptx" hidden @change="uploadDocument">
        </label>

      </div>

      <div v-if="statusMessage" class="status-message">{{ statusMessage }}</div>

      <div class="demos-list">
        <AnnotationDemo
          title="1. Redaction"
          description="Both redaction tools create pspdfkit/markup/redaction. The area tool always stores exactly one rect — compatible with single-rectangle storage. Draw on the document to create a redaction, then check DB to validate content."
        >
          <div class="btn-row">
            <button class="btn" @click="demoAreaRedaction">Area Redaction Tool</button>
            <button class="btn" @click="demoTextRedaction">Text Redaction Tool</button>
          </div>
        </AnnotationDemo>

        <AnnotationDemo
          title="2. Stamps"
          description="Text stamps use title/subtitle/color (pspdfkit/stamp). Image stamps use ImageAnnotation + setStampAnnotationTemplates() and serialize as pspdfkit/image. Custom text stamps render text to canvas with font control, then register as image stamps."
        >
          <button class="btn" @click="demoStamp">Open Stamp Picker</button>
          <label class="btn" style="text-align: center; cursor: pointer;">
            Add Image Stamp...
            <input ref="imageStampInput" type="file" accept="image/png,image/jpeg" hidden @change="registerImageStamp">
          </label>
          <div class="stamp-text-controls">
            <div class="stamp-row">
              <textarea v-model="stampText" class="stamp-textarea" rows="2" placeholder="Stamp text (use Enter for new lines)..." />
              <input v-model="stampColor" type="color" class="stamp-color" />
            </div>
            <div class="stamp-row">
              <select v-model="stampFontFamily" class="stamp-select">
                <option value="Arial">Arial</option>
                <option value="Georgia">Georgia</option>
                <option value="Courier New">Courier New</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Verdana">Verdana</option>
                <option value="Impact">Impact</option>
              </select>
              <select v-model.number="stampFontSize" class="stamp-select">
                <option :value="18">18px</option>
                <option :value="24">24px</option>
                <option :value="32">32px</option>
                <option :value="48">48px</option>
                <option :value="64">64px</option>
              </select>
            </div>
            <div class="stamp-row stamp-image-row">
              <label class="btn stamp-image-btn">
                {{ stampImageFile ? stampImageFile.name : 'Add Image...' }}
                <input ref="stampImageInput" type="file" accept="image/png,image/jpeg,image/svg+xml" hidden @change="onStampImageSelected">
              </label>
              <button v-if="stampImageFile" class="btn-small" @click="clearStampImage">Remove</button>
            </div>
            <button class="btn" @click="registerTextStamp">Add Text Stamp to Picker</button>
          </div>
        </AnnotationDemo>

        <AnnotationDemo
          title="3. Arrow"
          description="Arrow tool in the main toolbar is restricted to openArrow only via LINE_CAP_PRESETS and setAnnotationPresets(). Secondary toolbar shows only delete. Click the Arrow tool in the toolbar above to try it."
        />

        <AnnotationDemo
          title="4. Ink (Line Overlay)"
          description="Freehand ink drawing (pspdfkit/ink). Bounding box is already stored in the DB content column via the bbox field — no reconstruction needed. Toolbar restricted to stroke-color, line-width, delete via annotationToolbarItems."
        >
          <button class="btn" @click="demoInk">Ink Drawing Tool</button>
        </AnnotationDemo>

        <AnnotationDemo
          title="5. Marker (Rectangle Overlay)"
          description="Rectangle with same fill/stroke color + opacity. Uses a single boundingBox — unlike pspdfkit/markup/highlight which stores multiple rects from text selection."
        >
          <button class="btn" @click="demoRectangle">Rectangle Tool</button>
        </AnnotationDemo>


        <AnnotationDemo
          title="6. Custom Fields (CreatedBy / ModifiedBy)"
          description="Annotations support customData for arbitrary key-value pairs + creatorName. Both persist through Instant JSON and Document Engine. Export JSON to verify round-trip."
        >
          <button class="btn" @click="demoCustomData">Create with Custom Data</button>
        </AnnotationDemo>
      </div>

      <!-- JSON Output -->
      <div v-if="jsonOutput" class="json-output">
        <div class="json-header">
          <span>Instant JSON</span>
          <button class="btn-small" @click="jsonOutput = ''">Clear</button>
        </div>
        <pre>{{ jsonOutput }}</pre>
      </div>
    </aside>

    <!-- Viewer -->
    <div class="viewer-area">
      <div v-if="!documentId" class="viewer-placeholder">
        <p>Upload a document to get started</p>
        <p class="hint">Use the sidebar to upload a PDF or DOCX file</p>
      </div>
      <DocumentViewer
        v-if="documentId"
        :document-id="documentId"
        :before-load="restrictLineCaps"
        @loaded="onViewerLoaded"
      />
    </div>
  </div>
</template>

<style scoped>
.page-layout {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 360px;
  flex-shrink: 0;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.sidebar-header h2 {
  font-size: 16px;
  margin-bottom: 4px;
}

.sidebar-subtitle {
  font-size: 12px;
  color: #888;
}

.sidebar-controls {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.upload-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  font-size: 12px;
  border: 1px dashed #aaa;
  border-radius: 6px;
  cursor: pointer;
  color: #555;
  text-align: center;
}

.upload-btn:hover {
  border-color: #666;
  color: #333;
}

.status-message {
  padding: 8px 16px;
  font-size: 12px;
  color: #1565c0;
  background: #e3f2fd;
  border-bottom: 1px solid #bbdefb;
}

.demos-list {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.btn {
  padding: 7px 14px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:hover {
  background: #f5f5f5;
  border-color: #999;
}

.btn-row {
  display: flex;
  gap: 6px;
}

.stamp-text-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid #eee;
}

.stamp-row {
  display: flex;
  gap: 6px;
}

.stamp-textarea {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: vertical;
  font-family: inherit;
}

.stamp-color {
  width: 32px;
  height: 30px;
  padding: 1px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
}

.stamp-select {
  flex: 1;
  padding: 6px 4px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.stamp-image-row {
  align-items: center;
}

.stamp-image-btn {
  flex: 1;
  text-align: center;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-secondary {
  flex: 1;
  padding: 8px;
  font-size: 12px;
  border: 1px solid #1565c0;
  border-radius: 6px;
  background: #fff;
  color: #1565c0;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #e3f2fd;
}

.json-output {
  border-top: 1px solid #e0e0e0;
  max-height: 300px;
  overflow: auto;
}

.json-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 600;
  background: #f5f5f5;
  position: sticky;
  top: 0;
}

.btn-small {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.json-output pre {
  padding: 8px 16px;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}

.viewer-area {
  flex: 1;
  position: relative;
}

.viewer-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}

.viewer-placeholder p {
  font-size: 16px;
}

.viewer-placeholder .hint {
  font-size: 13px;
  margin-top: 4px;
  color: #bbb;
}
</style>
