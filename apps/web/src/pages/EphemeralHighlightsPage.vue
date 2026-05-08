<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Instance, SearchResult, Rect } from '@nutrient-sdk/viewer'
import { getNutrientViewer } from '@/nutrient'
import DocumentViewer from '@/components/DocumentViewer.vue'

// Side-by-side testbed for the default smart-search path vs the new opt-in
// `SearchType.WORD_BASED` mode (CORE-1101). Word-based strips Unicode space
// variants plus tab/newline/CR from query and page text and substring-matches
// with punctuation preserved — designed to handle long multi-line phrases that
// cross structural boundaries (tables, columns, page wraps) which the regex-
// based default cannot bridge.

type SearchMode = 'default' | 'word_based'

const route = useRoute()
const router = useRouter()

const instance = ref<Instance | null>(null)
// Seed from `?documentId=` so a previously-uploaded doc can be shared via URL,
// matching the convention used by the other DE-mode pages.
const documentId = ref<string>((route.query.documentId as string) || '')
const statusMessage = ref<string>('')
const isUploading = ref(false)
const searchMode = ref<SearchMode>('default')

// Keep the URL in sync so reloads / shared links land on the same doc.
watch(documentId, (id) => {
  router.replace({ query: id ? { documentId: id } : {} })
})

// Phrase sets per reference document. Phrases come verbatim from the
// `Highlights.txt` shipped with each PDF — multi-line where appropriate.
// Order and labels are intentionally anonymized; users upload their own doc
// matching the active preset.
type PresetKey = 'doc-1' | 'doc-2' | 'doc-3'

const PRESETS: Record<PresetKey, { label: string; phrases: string[] }> = {
  'doc-1': {
    label: '1',
    phrases: [
      'Nextverse hereby commits to delivering SSO support for HelioCare for the\nNextverse One™ platform by Q3 2026.',
    ],
  },
  'doc-2': {
    label: '2',
    phrases: [
      '■MDS+ D/A-Wandler mit vier parallelen Schaltungen',
      'bietet der DP-570 eine fast doppelt so hohe Leistung (=√4) bezüglich Klirrfaktor',
    ],
  },
  'doc-3': {
    label: '3',
    phrases: [
      '● High power output of 180 watts into 8 ohms / 260 watts into 4 ohms ●',
      'Rated Output\n(20 to 20,000 Hz, 0.05%) Both channels driven 4-ohm load * 260 W / ch\n8-ohm load 180 W / ch',
      'The rear panel expansion slots allow use\nof three types of option boards (DAC-60,\nAD-50, LINE-10). Up to two boards can\nbe installed, according to requirements.',
      `DAC-50 / DAC-40 /
DAC-30 / DAC-20 /
DAC-10
AD-30 / AD-20 /
AD-10 / AD-9
LINE-9
Digital Input
Board
Analog Record
Input Board
Line Input
Board
■ The following option
boards can also be used:
The rear panel expansion slots allow use
of three types of option boards (DAC-60,
AD-50, LINE-10). Up to two boards can
be installed, according to requirements.
Input
32 to 384 kHz
32 to 96 kHz
32 to 192 kHz
USB
OPTICAL
COAXIAL
Signal
DSD
PCM
PCM
PCM
Number of bits
1-bit
32-bit
24-bit
24-bit
Sampling frequencies
2.8 MHz
5.6 MHz
11.2 MHz
11.2 MHz:
ASIO only`,
    ],
  },
}

const activePreset = ref<PresetKey>('doc-1')
const phrases = computed<string[]>(() => PRESETS[activePreset.value].phrases)

// Match counts cached per phrase per mode. Length tracks the active preset's
// phrase list — recreated when the preset changes via the watcher below.
type Counts = number[]
const counts = ref<Record<SearchMode, Counts>>({
  default: phrases.value.map(() => 0),
  word_based: phrases.value.map(() => 0),
})

// Yellow rect with mixBlendMode: multiply + opacity 0.4 reads like a
// highlighter pen rather than an opaque overlay.
const HIGHLIGHT_BG = '#ded701ff'
const HIGHLIGHT_OPACITY = '0.4'

const overlayIds: string[] = []

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

  isUploading.value = true
  try {
    const id = await uploadFile(file)
    if (id) {
      documentId.value = id
      showStatus(`Uploaded: ${file.name}`)
    }
  } catch (err) {
    showStatus(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    isUploading.value = false
    input.value = ''
  }
}

function onViewerLoaded(inst: Instance) {
  instance.value = inst
  // Auto-run in the currently-selected mode so the user sees results
  // immediately on document load.
  void runAndRender()
}

function buildHighlightNode(rect: Rect): HTMLDivElement {
  const node = document.createElement('div')
  node.style.width = `${rect.width}px`
  node.style.height = `${rect.height}px`
  node.style.backgroundColor = HIGHLIGHT_BG
  node.style.opacity = HIGHLIGHT_OPACITY
  node.style.mixBlendMode = 'multiply'
  // pointer-events: none so PDF text underneath stays selectable.
  node.style.pointerEvents = 'none'
  return node
}

// CustomOverlayItem wraps our node in two SDK divs that default to
// pointer-events: auto. Walk up two levels and disable both so text selection
// drops through to the PDF text layer.
function disableWrapperPointerEvents(node: HTMLElement) {
  let el: HTMLElement | null = node.parentElement
  let depth = 0
  while (el && depth < 2) {
    el.style.pointerEvents = 'none'
    el = el.parentElement
    depth++
  }
}

async function clearOverlays() {
  const inst = instance.value
  for (const id of overlayIds) {
    // Stale IDs can linger across re-uploads (the old instance is destroyed
    // before this runs, so the IDs no longer exist on the new instance).
    // Swallow any "unknown overlay" errors and keep going.
    try {
      inst?.removeCustomOverlayItem(id)
    } catch {
      // ignore
    }
  }
  overlayIds.length = 0
}

async function runAndRender() {
  const inst = instance.value
  if (!inst) return

  const SDK = await getNutrientViewer()
  await clearOverlays()

  const searchType =
    searchMode.value === 'word_based' ? SDK.SearchType.WORD_BASED : SDK.SearchType.TEXT

  const list = phrases.value
  const newCounts: Counts = []
  for (let phraseIdx = 0; phraseIdx < list.length; phraseIdx++) {
    // Loop bound guarantees the index is valid; satisfy `noUncheckedIndexedAccess`.
    const phrase = list[phraseIdx]!
    const results = await inst.search(phrase, { searchType })
    newCounts.push(results.size)

    results.forEach((result: SearchResult, resultIdx: number) => {
      const pageIndex = result.pageIndex
      if (pageIndex == null) return
      result.rectsOnPage.forEach((rect: Rect, rectIdx: number) => {
        const id = `wbsearch-${searchMode.value}-${phraseIdx}-${resultIdx}-${rectIdx}`
        const node = buildHighlightNode(rect)
        const item = new SDK.CustomOverlayItem({
          id,
          pageIndex,
          position: new SDK.Geometry.Point({ x: rect.left, y: rect.top }),
          node,
          onAppear: () => disableWrapperPointerEvents(node),
        })
        inst.setCustomOverlayItem(item)
        overlayIds.push(id)
      })
    })
  }

  counts.value = { ...counts.value, [searchMode.value]: newCounts }
}

// Re-run on mode change so highlights swap to the new mode's matches.
watch(searchMode, () => {
  void runAndRender()
})

// On preset change, reset cached counts to a fresh zero-array sized for the
// new phrase list, then re-run the active mode if a doc is loaded.
watch(activePreset, () => {
  counts.value = {
    default: phrases.value.map(() => 0),
    word_based: phrases.value.map(() => 0),
  }
  if (instance.value) void runAndRender()
})

onBeforeUnmount(() => {
  overlayIds.length = 0
})

const totalForMode = (mode: SearchMode) =>
  counts.value[mode].reduce((acc, n) => acc + n, 0)
</script>

<template>
  <div class="page-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Word-Based Search Comparison</h2>
        <p class="sidebar-subtitle">
          Compare default smart-search against the opt-in
          <code>SearchType.WORD_BASED</code> (CORE-1101). Upload a PDF, toggle
          the mode, and watch which phrases match.
        </p>
      </div>

      <div class="sidebar-controls">
        <label class="upload-btn">
          {{ documentId ? 'Upload Different Document' : 'Upload PDF' }}
          <input type="file" accept=".pdf,.docx" hidden @change="uploadDocument">
        </label>
      </div>

      <div class="preset-controls">
        <label for="preset-select" class="preset-label">Reference document:</label>
        <select id="preset-select" v-model="activePreset" class="preset-select">
          <option v-for="(preset, key) in PRESETS" :key="key" :value="key">
            {{ preset.label }}
          </option>
        </select>
      </div>

      <div class="mode-controls">
        <span class="mode-label">Search mode:</span>
        <div class="mode-toggle">
          <button
            class="mode-btn"
            :class="{ active: searchMode === 'default' }"
            title="Default smart-search (regex with line-wrap tolerance)"
            @click="searchMode = 'default'"
          >
            Default
          </button>
          <button
            class="mode-btn"
            :class="{ active: searchMode === 'word_based' }"
            title="Word-based: strips whitespace, substring-matches with punctuation preserved"
            @click="searchMode = 'word_based'"
          >
            Word-based
          </button>
        </div>
      </div>

      <div v-if="statusMessage" class="status-message">{{ statusMessage }}</div>

      <div class="phrases-list">
        <div class="phrases-header">
          <span class="phrases-title">Phrases</span>
          <span class="phrases-meta">
            Total: <strong>{{ totalForMode(searchMode) }}</strong> match{{ totalForMode(searchMode) === 1 ? '' : 'es' }}
          </span>
        </div>

        <div
          v-for="(phrase, i) in phrases"
          :key="`${activePreset}-${i}`"
          class="phrase-card"
        >
          <div class="phrase-index">Phrase {{ i + 1 }}</div>
          <pre class="phrase-text">{{ phrase }}</pre>
          <div class="phrase-counts">
            <span
              class="count-pill"
              :class="{ active: searchMode === 'default', zero: counts.default[i] === 0 }"
            >
              Default: {{ counts.default[i] }}
            </span>
            <span
              class="count-pill word"
              :class="{ active: searchMode === 'word_based', zero: counts.word_based[i] === 0 }"
            >
              Word-based: {{ counts.word_based[i] }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <div class="viewer-area">
      <div v-if="!documentId && isUploading" class="viewer-placeholder">
        <p>Uploading…</p>
      </div>
      <div v-else-if="!documentId" class="viewer-placeholder">
        <p>No document loaded</p>
        <p class="hint">Upload a PDF from the sidebar to begin</p>
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
  width: 420px;
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

.sidebar-subtitle code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #f0f0f0;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

.sidebar-controls {
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
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

.preset-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.preset-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.preset-select {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  color: #1f2328;
  cursor: pointer;
}

.preset-select:focus {
  outline: none;
  border-color: #1565c0;
  box-shadow: 0 0 0 2px rgba(21, 101, 192, 0.15);
}

.mode-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
}

.mode-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.mode-toggle {
  display: inline-flex;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  overflow: hidden;
}

.mode-btn {
  border: none;
  padding: 5px 12px;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  color: #1f2328;
  transition: all 0.15s;
}

.mode-btn:hover:not(.active) {
  background: rgba(0, 0, 0, 0.04);
}

.mode-btn.active {
  background: #1565c0;
  color: #fff;
  font-weight: 600;
}

.status-message {
  padding: 8px 16px;
  font-size: 12px;
  color: #1565c0;
  background: #e3f2fd;
  border-bottom: 1px solid #bbdefb;
}

.phrases-list {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phrases-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.phrases-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #656d76;
}

.phrases-meta {
  font-size: 11px;
  color: #656d76;
}

.phrase-card {
  border: 1px solid #eaeef2;
  background: #f6f8fa;
  border-radius: 6px;
  padding: 10px;
}

.phrase-index {
  font-size: 11px;
  font-weight: 600;
  color: #1f2328;
  margin-bottom: 6px;
}

.phrase-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.5;
  color: #444;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 6px 8px;
  margin-bottom: 8px;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.phrase-counts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.count-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(21, 101, 192, 0.1);
  color: #1565c0;
  font-weight: 600;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.count-pill.word {
  background: rgba(46, 125, 50, 0.1);
  color: #2e7d32;
}

.count-pill.zero {
  background: rgba(0, 0, 0, 0.06);
  color: #888;
  font-weight: 400;
}

.count-pill.active {
  border-color: currentColor;
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
