<script setup lang="ts">
import { ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Instance, SearchResult, Rect } from '@nutrient-sdk/viewer'
import { getNutrientViewer } from '@/nutrient'
import DocumentViewer from '@/components/DocumentViewer.vue'
import AnnotationDemo from '@/components/AnnotationDemo.vue'

const route = useRoute()
const router = useRouter()

const instance = ref<Instance | null>(null)
const documentId = ref<string>((route.query.documentId as string) || '')
const statusMessage = ref<string>('')
const isAutoLoading = ref(false)

const DEFAULT_DOC_PATH = '/documents/LeaseContract.pdf'
const DEFAULT_DOC_FILENAME = 'LeaseContract.pdf'
const CACHE_KEY = 'ephemeral-highlights-doc-id-v1'

type HighlightSource = 'fts' | 'ai' | 'invoice'

const SOURCE_CONFIG: Record<HighlightSource, { label: string; color: string; phrases: string[] }> = {
  fts: {
    label: 'FTS Search Hits',
    color: 'rgba(255, 235, 59, 0.45)',
    phrases: ['Lease Agreement', 'Equipment', 'Lessor', 'Lessee'],
  },
  ai: {
    // Multi-line phrases — these wrap across line breaks in the PDF.
    // instance.search() handles line breaks transparently, returning one rect per line.
    label: 'AI Citations (multi-line)',
    color: 'rgba(33, 150, 243, 0.35)',
    phrases: [
      'Nextverse Inc., having its principal place of business at',
      'Highfly Corp., having its principal place of business at',
      'thirty (30) days written notice',
    ],
  },
  invoice: {
    label: 'Invoice Fields',
    color: 'rgba(76, 175, 80, 0.4)',
    phrases: ['$5,000 USD', 'June 12, 2025', 'July 1, 2025', 'XR-900', 'Authorized Signatory'],
  },
}

const overlayIdsBySource = new Map<HighlightSource, string[]>()
const counts = ref<Record<HighlightSource, number>>({ fts: 0, ai: 0, invoice: 0 })

watch(documentId, (id) => {
  router.replace({ query: id ? { documentId: id } : {} })
})

function showStatus(msg: string) {
  statusMessage.value = msg
  setTimeout(() => {
    if (statusMessage.value === msg) statusMessage.value = ''
  }, 3000)
}

async function uploadFile(file: File): Promise<string | null> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/documents', { method: 'POST', body: formData })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Upload failed: ${res.status}`)
  }
  const data = await res.json()
  return data.documentId ?? null
}

async function uploadDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const id = await uploadFile(file)
    if (id) {
      documentId.value = id
      localStorage.setItem(CACHE_KEY, id)
      showStatus(`Uploaded: ${file.name}`)
    }
  } catch (err) {
    showStatus(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function autoLoadDefaultDocument() {
  if (documentId.value) return

  const cached = localStorage.getItem(CACHE_KEY)
  if (cached) {
    documentId.value = cached
    return
  }

  isAutoLoading.value = true
  try {
    const res = await fetch(DEFAULT_DOC_PATH)
    if (!res.ok) throw new Error(`Could not fetch ${DEFAULT_DOC_PATH} (${res.status})`)
    const blob = await res.blob()
    const file = new File([blob], DEFAULT_DOC_FILENAME, { type: 'application/pdf' })
    const id = await uploadFile(file)
    if (id) {
      documentId.value = id
      localStorage.setItem(CACHE_KEY, id)
      showStatus(`Loaded default document: ${DEFAULT_DOC_FILENAME}`)
    }
  } catch (err) {
    showStatus(`Auto-load failed — upload manually. (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    isAutoLoading.value = false
  }
}

function resetDefaultDocument() {
  localStorage.removeItem(CACHE_KEY)
  documentId.value = ''
  autoLoadDefaultDocument()
}

function onViewerLoaded(inst: Instance) {
  instance.value = inst
  showStatus('Document loaded — try the highlight buttons in the sidebar')
}

function buildHighlightNode(color: string, rect: Rect): HTMLDivElement {
  const node = document.createElement('div')
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.style.background = color
  node.style.borderRadius = '2px'
  node.style.pointerEvents = 'none'
  // Match the SDK's native search-highlight look — multiplies the color into the
  // page underneath so it reads like ink/marker rather than an opaque overlay.
  node.style.mixBlendMode = 'multiply'
  return node
}

// CustomOverlayItem wraps our node in two SDK divs (a transform wrapper and a host
// element), both of which default to pointer-events: auto and sit above the PDF
// text layer. Setting pointer-events: none on our inner div alone isn't enough —
// the wrappers still capture mousedown/selectionchange and the SDK's selection-
// prevention handler fires when the selection's anchor is inside the host. We walk
// up the chain after mount and disable pointer-events on both wrappers so selection
// drops through to the text layer underneath.
function disableWrapperPointerEvents(node: HTMLElement) {
  let el: HTMLElement | null = node.parentElement
  let depth = 0
  while (el && depth < 2) {
    el.style.pointerEvents = 'none'
    el = el.parentElement
    depth++
  }
}

async function highlight(source: HighlightSource) {
  const inst = instance.value
  if (!inst) {
    showStatus('Load a document first')
    return
  }

  await clear(source)

  const SDK = await getNutrientViewer()
  const { color, phrases } = SOURCE_CONFIG[source]
  const ids: string[] = []

  for (const phrase of phrases) {
    const results: ReturnType<Instance['search']> extends Promise<infer R> ? R : never =
      await inst.search(phrase, { searchType: SDK.SearchType.TEXT })

    results.forEach((result: SearchResult, resultIdx: number) => {
      const pageIndex = result.pageIndex
      if (pageIndex == null) return

      result.rectsOnPage.forEach((rect: Rect, rectIdx: number) => {
        const id = `ephemeral-${source}-${phrase}-${resultIdx}-${rectIdx}`
        const node = buildHighlightNode(color, rect)
        const item = new SDK.CustomOverlayItem({
          id,
          pageIndex,
          position: new SDK.Geometry.Point({ x: rect.left, y: rect.top }),
          node,
          onAppear: () => disableWrapperPointerEvents(node),
        })
        inst.setCustomOverlayItem(item)
        ids.push(id)
      })
    })
  }

  overlayIdsBySource.set(source, ids)
  counts.value = { ...counts.value, [source]: ids.length }
  showStatus(`Added ${ids.length} ${SOURCE_CONFIG[source].label} highlights`)
}

async function clear(source: HighlightSource) {
  const inst = instance.value
  if (!inst) return

  const ids = overlayIdsBySource.get(source) ?? []
  for (const id of ids) {
    inst.removeCustomOverlayItem(id)
  }
  overlayIdsBySource.set(source, [])
  counts.value = { ...counts.value, [source]: 0 }
}

async function clearAll() {
  for (const source of Object.keys(SOURCE_CONFIG) as HighlightSource[]) {
    await clear(source)
  }
  showStatus('Cleared all ephemeral highlights')
}

onMounted(() => {
  autoLoadDefaultDocument()
})

onBeforeUnmount(() => {
  // Overlays are cleaned up automatically when the viewer unloads,
  // but reset the map so a remount starts clean.
  overlayIdsBySource.clear()
})
</script>

<template>
  <div class="page-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Non-Persistent Highlights</h2>
        <p class="sidebar-subtitle">
          Overlay ephemeral highlights from external sources (FTS, AI, invoice extractor) without ever
          touching Document Engine. User annotations + search continue to work normally.
        </p>
      </div>

      <div class="sidebar-controls">
        <label class="upload-btn">
          Upload Different Document
          <input type="file" accept=".pdf,.docx" hidden @change="uploadDocument">
        </label>
        <button class="btn btn-small reset-btn" title="Discard cached document and re-upload LeaseContract.pdf" @click="resetDefaultDocument">
          Reset
        </button>
      </div>

      <div v-if="statusMessage" class="status-message">{{ statusMessage }}</div>

      <div class="demos-list">
        <AnnotationDemo
          title="Approach 1: setCustomOverlayItem (recommended)"
          description="Search returns rects, we drop a colored div on each rect via CustomOverlayItem. Independent of annotations and searchState. Multi-color via inline styles. The three sections below (FTS / AI / Invoice) all use this same approach with different colors."
        >
          <pre class="code-snippet"><code>const results = await instance.search(phrase)

results.forEach(r =&gt; {
  r.rectsOnPage.forEach(rect =&gt; {
    const node = document.createElement('div')
    node.style.background = color
    node.style.mixBlendMode = 'multiply'
    node.style.pointerEvents = 'none'

    instance.setCustomOverlayItem(
      new SDK.CustomOverlayItem({
        id, pageIndex: r.pageIndex,
        position: { x: rect.left, y: rect.top },
        node,
        onAppear: () =&gt; {
          // walk up 2 wrappers, set pointer-events: none
          // so selection passes through to PDF text
        },
      })
    )
  })
})</code></pre>
        </AnnotationDemo>

        <AnnotationDemo
          title="1. FTS Search Hits"
          description="Simulates highlighting matches from a full-text search backend. Yellow overlays sit on top of the rendered page; nothing is sent to Document Engine."
        >
          <div class="phrase-list">
            <span v-for="p in SOURCE_CONFIG.fts.phrases" :key="p" class="phrase-chip fts">{{ p }}</span>
          </div>
          <div class="btn-row">
            <button class="btn" @click="highlight('fts')">Highlight ({{ counts.fts }})</button>
            <button class="btn" @click="clear('fts')">Clear</button>
          </div>
        </AnnotationDemo>

        <AnnotationDemo
          title="2. AI Citations"
          description="Simulates highlighting passages an AI assistant cited as evidence. Blue overlays — different color per source is trivial because each overlay is just a styled DOM node."
        >
          <div class="phrase-list">
            <span v-for="p in SOURCE_CONFIG.ai.phrases" :key="p" class="phrase-chip ai">{{ p }}</span>
          </div>
          <div class="btn-row">
            <button class="btn" @click="highlight('ai')">Highlight ({{ counts.ai }})</button>
            <button class="btn" @click="clear('ai')">Clear</button>
          </div>
        </AnnotationDemo>

        <AnnotationDemo
          title="3. Invoice Field Extractions"
          description="Simulates highlighting fields located by an invoice preprocessor. Green overlays. Combine multiple sources at once — they coexist freely."
        >
          <div class="phrase-list">
            <span v-for="p in SOURCE_CONFIG.invoice.phrases" :key="p" class="phrase-chip invoice">{{ p }}</span>
          </div>
          <div class="btn-row">
            <button class="btn" @click="highlight('invoice')">Highlight ({{ counts.invoice }})</button>
            <button class="btn" @click="clear('invoice')">Clear</button>
          </div>
        </AnnotationDemo>

        <AnnotationDemo
          title="Proof points"
          description="Verify the pattern doesn't break anything else in the viewer."
        >
          <ul class="proof-list">
            <li>Open the search bar (Ctrl/Cmd+F) — highlights persist while you search.</li>
            <li>Draw a rectangle / sticky note — saves to Document Engine normally.</li>
            <li>Select PDF text under a highlight and Ctrl/Cmd+C — copy works.</li>
            <li>Reload the page — ephemerals disappear (proves nothing was persisted).</li>
          </ul>
          <button class="btn btn-danger" @click="clearAll">Clear all highlights</button>
        </AnnotationDemo>
      </div>
    </aside>

    <div class="viewer-area">
      <div v-if="!documentId && isAutoLoading" class="viewer-placeholder">
        <p>Loading default document…</p>
        <p class="hint">{{ DEFAULT_DOC_FILENAME }}</p>
      </div>
      <div v-else-if="!documentId" class="viewer-placeholder">
        <p>No document loaded</p>
        <p class="hint">Upload one from the sidebar, or hit Reset to retry the default</p>
      </div>
      <DocumentViewer
        v-if="documentId"
        :document-id="documentId"
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
  width: 380px;
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
  margin-bottom: 6px;
}

.sidebar-subtitle {
  font-size: 12px;
  color: #666;
  line-height: 1.5;
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

.btn-small {
  padding: 6px 10px;
  font-size: 11px;
}

.reset-btn {
  flex-shrink: 0;
}

.btn-danger {
  width: 100%;
  margin-top: 8px;
  color: #c62828;
  border-color: #e57373;
}

.btn-danger:hover {
  background: #ffebee;
  border-color: #c62828;
}

.phrase-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.phrase-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.phrase-chip.fts {
  background: rgba(255, 235, 59, 0.45);
  color: #6b5800;
}

.phrase-chip.ai {
  background: rgba(33, 150, 243, 0.25);
  color: #0d47a1;
}

.phrase-chip.invoice {
  background: rgba(76, 175, 80, 0.3);
  color: #1b5e20;
}

.code-snippet {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre;
}

.code-snippet code {
  font-family: inherit;
  background: transparent;
  padding: 0;
  color: inherit;
}

.proof-list {
  font-size: 12px;
  color: #555;
  line-height: 1.6;
  padding-left: 18px;
  margin: 0;
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
