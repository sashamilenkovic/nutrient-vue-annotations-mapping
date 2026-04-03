<script setup lang="ts">
import { ref, onBeforeUnmount, computed } from 'vue'
import type { Instance } from '@nutrient-sdk/viewer'
import type NutrientViewer from '@nutrient-sdk/viewer'
import { getNutrientViewer, baseUrl, licenseKey } from '@/nutrient'

const containerEl = ref<HTMLElement | null>(null)
const instance = ref<Instance | null>(null)
const SDK = ref<typeof NutrientViewer | null>(null)
const isLoading = ref(false)
const stampsPlaced = ref(false)

// Tracks which template the selected annotation matches
const selectedSnippetLabel = ref<string | null>(null)
const selectedSnippetCode = ref<string | null>(null)

interface StampTemplate {
  label: string
  width: number
  height: number
  needsImage?: boolean
  snippet: string
  // Used to match a selected annotation back to this template
  match: (ann: any) => boolean
  create: (sdk: typeof NutrientViewer, pageIndex: number, rect: any, imageAttachmentId?: string) => any
}

const STAMP_TEMPLATES: StampTemplate[] = [
  {
    label: 'Multiline Text (Helvetica Bold)',
    width: 300, height: 80,
    snippet: `new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "APPROVED\\nQuality Control Dept.\\n2026-04-03",
  multiline: true,
  font: "Helvetica",
  fontSize: 14,
  fontColor: new Color({ r: 0, g: 100, b: 0 }),
  isBold: true,
  color: new Color({ r: 0, g: 100, b: 0 }),
})`,
    match: (ann) => ann.title?.startsWith('APPROVED\nQuality'),
    create: (sdk, pageIndex, rect) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'APPROVED\nQuality Control Dept.\n' + new Date().toISOString().slice(0, 10),
        boundingBox: rect,
        multiline: true,
        font: 'Helvetica',
        fontSize: 14,
        fontColor: new sdk.Color({ r: 0, g: 100, b: 0 }),
        isBold: true,
        color: new sdk.Color({ r: 0, g: 100, b: 0 }),
      }),
  },
  {
    label: 'Multiline Text (Courier Bold+Italic)',
    width: 300, height: 60,
    snippet: `new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "CONFIDENTIAL\\nFor Internal Use Only",
  multiline: true,
  font: "Courier",
  fontSize: 13,
  fontColor: new Color({ r: 180, g: 0, b: 0 }),
  isBold: true,
  isItalic: true,
  color: new Color({ r: 180, g: 0, b: 0 }),
})`,
    match: (ann) => ann.title?.startsWith('CONFIDENTIAL'),
    create: (sdk, pageIndex, rect) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'CONFIDENTIAL\nFor Internal Use Only',
        boundingBox: rect,
        multiline: true,
        font: 'Courier',
        fontSize: 13,
        fontColor: new sdk.Color({ r: 180, g: 0, b: 0 }),
        isBold: true,
        isItalic: true,
        color: new sdk.Color({ r: 180, g: 0, b: 0 }),
      }),
  },
  {
    label: 'Text + Embedded Image (horizontal)',
    width: 340, height: 80,
    needsImage: true,
    snippet: `const imageAttachmentId = await instance.createAttachment(pngFile);

new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "VERIFIED\\nDocument Check Passed\\nInspector: J. Smith",
  multiline: true,
  font: "Helvetica",
  fontSize: 12,
  fontColor: new Color({ r: 26, g: 35, b: 126 }),
  isBold: true,
  color: new Color({ r: 57, g: 73, b: 171 }),
  imageAttachmentId,
  imageContentType: "image/png",
})`,
    match: (ann) => ann.title?.startsWith('VERIFIED'),
    create: (sdk, pageIndex, rect, imageAttachmentId) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'VERIFIED\nDocument Check Passed\nInspector: J. Smith',
        boundingBox: rect,
        multiline: true,
        font: 'Helvetica',
        fontSize: 12,
        fontColor: new sdk.Color({ r: 26, g: 35, b: 126 }),
        isBold: true,
        color: new sdk.Color({ r: 57, g: 73, b: 171 }),
        imageAttachmentId,
        imageContentType: 'image/png',
      }),
  },
  {
    label: 'Image Position: Top (row: 0)',
    width: 200, height: 120,
    needsImage: true,
    snippet: `const imageAttachmentId = await instance.createAttachment(pngFile);

new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "APPROVED\\n2026-04-03",
  multiline: true,
  font: "Helvetica",
  fontSize: 12,
  fontColor: new Color({ r: 0, g: 100, b: 0 }),
  isBold: true,
  color: new Color({ r: 0, g: 100, b: 0 }),
  imageAttachmentId,
  imageContentType: "image/png",
  imagePosition: { row: 0, align: "center" },
})`,
    match: (ann) => ann.imagePosition?.row === 0,
    create: (sdk, pageIndex, rect, imageAttachmentId) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'APPROVED\n' + new Date().toISOString().slice(0, 10),
        boundingBox: rect,
        multiline: true,
        font: 'Helvetica',
        fontSize: 12,
        fontColor: new sdk.Color({ r: 0, g: 100, b: 0 }),
        isBold: true,
        color: new sdk.Color({ r: 0, g: 100, b: 0 }),
        imageAttachmentId,
        imageContentType: 'image/png',
        imagePosition: { row: 0, align: 'center' },
      }),
  },
  {
    label: 'Image Position: Middle (row: 1)',
    width: 200, height: 120,
    needsImage: true,
    snippet: `const imageAttachmentId = await instance.createAttachment(pngFile);

new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "APPROVED\\n2026-04-03",
  multiline: true,
  font: "Helvetica",
  fontSize: 12,
  fontColor: new Color({ r: 0, g: 0, b: 128 }),
  isBold: true,
  color: new Color({ r: 0, g: 0, b: 128 }),
  imageAttachmentId,
  imageContentType: "image/png",
  imagePosition: { row: 1, align: "center" },
})`,
    match: (ann) => ann.imagePosition?.row === 1,
    create: (sdk, pageIndex, rect, imageAttachmentId) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'APPROVED\n' + new Date().toISOString().slice(0, 10),
        boundingBox: rect,
        multiline: true,
        font: 'Helvetica',
        fontSize: 12,
        fontColor: new sdk.Color({ r: 0, g: 0, b: 128 }),
        isBold: true,
        color: new sdk.Color({ r: 0, g: 0, b: 128 }),
        imageAttachmentId,
        imageContentType: 'image/png',
        imagePosition: { row: 1, align: 'center' },
      }),
  },
  {
    label: 'Image Position: Bottom (row: 2, align: right)',
    width: 200, height: 120,
    needsImage: true,
    snippet: `const imageAttachmentId = await instance.createAttachment(pngFile);

new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "Reviewed By\\nJ. Smith",
  multiline: true,
  font: "Courier",
  fontSize: 11,
  fontColor: new Color({ r: 128, g: 0, b: 0 }),
  isBold: true,
  color: new Color({ r: 128, g: 0, b: 0 }),
  imageAttachmentId,
  imageContentType: "image/png",
  imagePosition: { row: 2, align: "right" },
})`,
    match: (ann) => ann.imagePosition?.row === 2 && ann.title?.startsWith('Reviewed'),
    create: (sdk, pageIndex, rect, imageAttachmentId) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'Reviewed By\nJ. Smith',
        boundingBox: rect,
        multiline: true,
        font: 'Courier',
        fontSize: 11,
        fontColor: new sdk.Color({ r: 128, g: 0, b: 0 }),
        isBold: true,
        color: new sdk.Color({ r: 128, g: 0, b: 0 }),
        imageAttachmentId,
        imageContentType: 'image/png',
        imagePosition: { row: 2, align: 'right' },
      }),
  },
  {
    label: 'Image Position: 5-Line (row: 2)',
    width: 250, height: 160,
    needsImage: true,
    snippet: `const imageAttachmentId = await instance.createAttachment(pngFile);

new Annotations.StampAnnotation({
  stampType: "Custom",
  title: "DEPARTMENT\\nEngineering\\nStatus: Active\\nDate: 01.04.2026\\nRef: DOC-4521",
  multiline: true,
  font: "Helvetica",
  fontSize: 10,
  fontColor: new Color({ r: 50, g: 50, b: 50 }),
  isBold: true,
  color: new Color({ r: 100, g: 100, b: 100 }),
  imageAttachmentId,
  imageContentType: "image/png",
  imagePosition: { row: 2, align: "center" },
})`,
    match: (ann) => ann.title?.startsWith('DEPARTMENT'),
    create: (sdk, pageIndex, rect, imageAttachmentId) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Custom',
        title: 'DEPARTMENT\nEngineering\nStatus: Active\nDate: 01.04.2026\nRef: DOC-4521',
        boundingBox: rect,
        multiline: true,
        font: 'Helvetica',
        fontSize: 10,
        fontColor: new sdk.Color({ r: 50, g: 50, b: 50 }),
        isBold: true,
        color: new sdk.Color({ r: 100, g: 100, b: 100 }),
        imageAttachmentId,
        imageContentType: 'image/png',
        imagePosition: { row: 2, align: 'center' },
      }),
  },
  {
    label: 'Built-in Stamp (Approved)',
    width: 200, height: 50,
    snippet: `// Built-in stamp type — no multiline, no image
new Annotations.StampAnnotation({
  stampType: "Approved",
})`,
    match: (ann) => ann.stampType === 'Approved',
    create: (sdk, pageIndex, rect) =>
      new sdk.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Approved',
        boundingBox: rect,
      }),
  },
]

// --- Canvas-generated checkmark icon ---

function createCheckmarkIcon(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(64, 64, 56, 0, Math.PI * 2)
  ctx.fillStyle = '#4CAF50'
  ctx.fill()
  ctx.strokeStyle = '#2E7D32'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(40, 68)
  ctx.lineTo(56, 84)
  ctx.lineTo(88, 44)
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 10
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
}

// --- Lifecycle ---

let checkmarkAttachmentId: string | null = null
let selectionSub: (() => void) | null = null

onBeforeUnmount(() => {
  selectionSub?.()
  if (containerEl.value && SDK.value) {
    try { SDK.value.unload(containerEl.value) } catch { /* ignore */ }
  }
})

// --- Document loading ---

async function loadDocument(buffer: ArrayBuffer) {
  if (!containerEl.value) return
  isLoading.value = true
  checkmarkAttachmentId = null
  stampsPlaced.value = false
  selectionSub?.()

  try {
    const sdk = await getNutrientViewer()
    SDK.value = sdk
    try { sdk.unload(containerEl.value) } catch { /* no previous */ }

    const inst = await sdk.load({
      container: containerEl.value,
      document: buffer,
      baseUrl,
      licenseKey,
    })
    instance.value = inst

    // Pre-create checkmark attachment
    const blob = await createCheckmarkIcon()
    const file = new File([blob], 'checkmark.png', { type: 'image/png' })
    checkmarkAttachmentId = await inst.createAttachment(file)

    // Listen for annotation selection changes
    selectionSub = inst.addEventListener('annotationSelection.change', (annotations: any) => {
      if (!annotations || annotations.size === 0) {
        selectedSnippetLabel.value = null
        selectedSnippetCode.value = null
        return
      }

      const ann = annotations.first()
      // Match to a template
      const matched = STAMP_TEMPLATES.find((t) => t.match(ann))
      if (matched) {
        selectedSnippetLabel.value = matched.label
        selectedSnippetCode.value = matched.snippet
      } else {
        selectedSnippetLabel.value = ann.stampType === 'Custom' ? 'Custom Stamp' : (ann.stampType ?? 'Stamp')
        selectedSnippetCode.value = JSON.stringify(ann.toJSON?.() ?? ann, null, 2)
      }
    })
  } finally {
    isLoading.value = false
  }
}

async function uploadDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await loadDocument(await file.arrayBuffer())
}

async function loadSamplePdf() {
  const resp = await fetch('/documents/sample.pdf')
  await loadDocument(await resp.arrayBuffer())
}

function clearDocument() {
  selectionSub?.()
  selectionSub = null
  if (containerEl.value && SDK.value) {
    try { SDK.value.unload(containerEl.value) } catch { /* ignore */ }
  }
  instance.value = null
  SDK.value = null
  stampsPlaced.value = false
  checkmarkAttachmentId = null
  selectedSnippetLabel.value = null
  selectedSnippetCode.value = null
}

// --- Add all stamps at once ---

async function addAllStamps() {
  const sdk = SDK.value
  const inst = instance.value
  if (!sdk || !inst) return

  const pageIndex = inst.viewState.currentPageIndex
  const imgId = checkmarkAttachmentId ?? undefined

  // Layout: 2 columns, stacked vertically
  // Standard letter page is 612x792pt — keep stamps within bounds
  const col1 = 20
  const col2 = 310
  let y = 20

  const stamps = []
  for (const template of STAMP_TEMPLATES) {
    const x = stamps.length % 2 === 0 ? col1 : col2
    if (stamps.length % 2 === 0 && stamps.length > 0) y += 140

    // Clamp width so it doesn't exceed page edge
    const maxWidth = 280
    const w = Math.min(template.width, maxWidth)

    const rect = new sdk.Geometry.Rect({
      left: x,
      top: y,
      width: w,
      height: template.height,
    })

    stamps.push(template.create(sdk, pageIndex, rect, template.needsImage ? imgId : undefined))
  }

  await inst.create(stamps)
  stampsPlaced.value = true
}
</script>

<template>
  <div class="page-layout">
    <aside class="sidebar">
      <h2 class="sidebar-title">Rich Stamp Annotations</h2>
      <p class="sidebar-hint">
        Multiline text, custom fonts, embedded images, and image positioning
        — all rendered by Core into a single appearance stream.
      </p>

      <label class="upload-btn">
        Upload PDF
        <input type="file" accept=".pdf" hidden @change="uploadDocument">
      </label>

      <button class="action-btn" @click="loadSamplePdf">
        Load Sample PDF
      </button>

      <button v-if="instance" class="action-btn clear-btn" @click="clearDocument">
        Clear
      </button>

      <template v-if="instance">
        <button class="action-btn primary" @click="addAllStamps" :disabled="stampsPlaced">
          {{ stampsPlaced ? 'Stamps Added' : 'Add All Stamp Variants' }}
        </button>

        <p v-if="stampsPlaced" class="sidebar-hint select-hint">
          Click any stamp on the document to see the API used to create it.
        </p>
      </template>
    </aside>

    <div class="main-area">
      <div class="viewer-area">
        <div v-if="!instance && !isLoading" class="viewer-placeholder">
          <p>Upload a PDF or load a sample to get started</p>
        </div>
        <div v-if="isLoading" class="viewer-placeholder">
          <p>Loading...</p>
        </div>
        <div ref="containerEl" class="viewer-container" />
      </div>

      <transition name="slide">
        <div v-if="selectedSnippetCode" class="code-panel">
          <div class="code-header">
            <span class="code-title">{{ selectedSnippetLabel }}</span>
            <button class="code-close" @click="selectedSnippetCode = null; selectedSnippetLabel = null">Close</button>
          </div>
          <pre class="code-body">{{ selectedSnippetCode }}</pre>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.page-layout {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 260px;
  flex-shrink: 0;
  padding: 16px;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
}

.sidebar-hint {
  font-size: 12px;
  color: #666;
  line-height: 1.4;
}

.select-hint {
  color: #1976D2;
  font-weight: 500;
}

.upload-btn {
  display: block;
  padding: 9px 12px;
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #2e7d32;
  text-align: center;
  transition: all 0.15s;
}

.upload-btn:hover {
  background: #c8e6c9;
}

.action-btn {
  padding: 9px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  text-align: center;
  transition: all 0.15s;
  color: #333;
}

.action-btn:hover {
  border-color: #999;
  background: #f5f5f5;
}

.action-btn.primary {
  background: #1a1a2e;
  color: #fff;
  border-color: #1a1a2e;
  font-weight: 600;
}

.action-btn.primary:hover {
  background: #2a2a4e;
}

.action-btn.primary:disabled {
  background: #4CAF50;
  border-color: #4CAF50;
  cursor: default;
  opacity: 0.9;
}

.clear-btn {
  color: #d32f2f;
  border-color: #ef9a9a;
}

.clear-btn:hover {
  background: #ffebee;
  border-color: #d32f2f;
}

/* Main area: viewer + code panel */
.main-area {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.viewer-area {
  flex: 1;
  min-height: 0;
  position: relative;
}

.viewer-container {
  width: 100%;
  height: 100%;
}

.viewer-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}

/* Code snippet panel */
.code-panel {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 520px;
  max-height: 400px;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #252526;
  border-bottom: 1px solid #333;
}

.code-title {
  color: #569cd6;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'SF Mono', Menlo, Monaco, monospace;
}

.code-close {
  background: none;
  border: 1px solid #555;
  color: #999;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 3px;
  cursor: pointer;
}

.code-close:hover {
  border-color: #888;
  color: #ccc;
}

.code-body {
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  white-space: pre;
  tab-size: 2;
  font-family: 'SF Mono', Menlo, Monaco, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d4;
}

/* Transition */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
