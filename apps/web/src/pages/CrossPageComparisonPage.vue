<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
import { getNutrientViewer, baseUrl, licenseKey } from '@/nutrient'

// --- Types ---
interface DiffResult {
  type: 'equal' | 'insert' | 'delete' | 'replace'
  text: string
}

interface ChangeItem {
  type: 'inserted' | 'deleted' | 'replaced'
  preview: string
  diffIndex: number
}

// --- State ---
const isLoading = ref(false)
const extractionProgress = ref('')
const error = ref('')
const wordLevel = ref(true)

const docAFile = ref<File | null>(null)
const docBFile = ref<File | null>(null)
const docAName = ref('(select Document A)')
const docBName = ref('(select Document B)')

const textA = ref('')
const textB = ref('')
const diffResults = ref<DiffResult[]>([])
const highlightedChange = ref<number | null>(null)
const diffRefs: Record<number, HTMLElement | null> = {}

// --- Computed ---
const changeItems = computed<ChangeItem[]>(() => {
  const items: ChangeItem[] = []
  diffResults.value.forEach((d, index) => {
    if (d.type === 'equal') return
    if (d.type === 'insert') {
      items.push({ type: 'inserted', preview: d.text.slice(0, 50), diffIndex: index })
    } else if (d.type === 'delete') {
      items.push({ type: 'deleted', preview: d.text.slice(0, 50), diffIndex: index })
    } else if (d.type === 'replace') {
      const [old, neu] = d.text.split('\u2192')
      items.push({
        type: 'replaced',
        preview: `${(old ?? '').slice(0, 25)} → ${(neu ?? '').slice(0, 25)}`,
        diffIndex: index,
      })
    }
  })
  return items
})

const stats = computed(() => {
  const diffs = diffResults.value
  let additions = 0
  let deletions = 0
  let replacements = 0
  let unchanged = 0

  for (const d of diffs) {
    const wordCount = d.text.trim().split(/\s+/).filter(Boolean).length
    if (d.type === 'insert') additions += wordCount
    else if (d.type === 'delete') deletions += wordCount
    else if (d.type === 'replace') replacements++
    else unchanged += wordCount
  }

  const total = additions + deletions + unchanged
  const changedPercent = total > 0 ? ((additions + deletions) / total) * 100 : 0

  return { additions, deletions, replacements, unchanged, changedPercent }
})

// --- Text extraction ---
async function extractText(file: File, label: string): Promise<string> {
  const SDK = await getNutrientViewer()
  let buffer = await file.arrayBuffer()
  const isDocx = file.name.toLowerCase().endsWith('.docx')


  // .docx: textLinesForPageIndex hangs in headless mode,
  // so convert to PDF first, then extract text from the PDF.
  if (isDocx) {
    extractionProgress.value = `${label}: converting .docx to PDF...`
    const convertContainer = document.createElement('div')
    convertContainer.style.display = 'none'
    document.body.appendChild(convertContainer)
    try {
      const loadConfig = {
        container: convertContainer,
        document: buffer,
        baseUrl,
        licenseKey,
        headless: true,
      }
      const convertInstance = await SDK.load(loadConfig)
      const pdfBuffer = await convertInstance.exportPDF()
      await SDK.unload(convertContainer)
      buffer = pdfBuffer.buffer as ArrayBuffer
    } finally {
      if (document.body.contains(convertContainer)) {
        document.body.removeChild(convertContainer)
      }
    }
  }

  const container = document.createElement('div')
  container.style.display = 'none'
  document.body.appendChild(container)

  try {
    extractionProgress.value = `Loading ${label}...`

    const instance = await SDK.load({
      container,
      document: buffer,
      baseUrl,
      licenseKey,
      headless: true,
    })

    const pageCount = instance.totalPageCount
    let allText = ''

    for (let i = 0; i < pageCount; i++) {
      extractionProgress.value = `${label}: extracting page ${i + 1}/${pageCount}`
      const textLines = await instance.textLinesForPageIndex(i)
      const pageText = textLines.map((l) => l.contents).join('\n')
      allText += pageText + '\n'
    }

    await SDK.unload(container)
    return allText.trim()
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container)
    }
  }
}

// --- Diff algorithm ---
function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
}

function lcs(arr1: string[], arr2: string[]): DiffResult[] {
  const m = arr1.length
  const n = arr2.length
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  const result: DiffResult[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && arr1[i - 1] === arr2[j - 1]) {
      result.unshift({ type: 'equal', text: arr1[i - 1]! })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.unshift({ type: 'insert', text: arr2[j - 1]! })
      j--
    } else if (i > 0) {
      result.unshift({ type: 'delete', text: arr1[i - 1]! })
      i--
    }
  }

  return result
}

function groupDiffs(diffs: DiffResult[]): DiffResult[] {
  if (diffs.length === 0) return []

  const grouped: DiffResult[] = []
  let i = 0

  while (i < diffs.length) {
    const current = diffs[i]!

    if (
      current.type === 'delete' &&
      i + 1 < diffs.length &&
      diffs[i + 1]!.type === 'insert'
    ) {
      const deleteText = current.text.trim()
      const insertText = diffs[i + 1]!.text.trim()

      const lengthRatio =
        Math.max(deleteText.length, insertText.length) /
        Math.max(Math.min(deleteText.length, insertText.length), 1)
      const isReplacement =
        deleteText.length > 0 &&
        insertText.length > 0 &&
        lengthRatio <= 3 &&
        /[a-zA-Z0-9]/.test(deleteText) &&
        /[a-zA-Z0-9]/.test(insertText)

      if (isReplacement) {
        grouped.push({
          type: 'replace',
          text: `${current.text}\u2192${diffs[i + 1]!.text}`,
        })
        i += 2
      } else {
        grouped.push(current)
        i++
      }
    } else {
      // Group consecutive same-type tokens
      let text = current.text
      let j = i + 1
      while (j < diffs.length && diffs[j]!.type === current.type) {
        text += diffs[j]!.text
        j++
      }
      grouped.push({ ...current, text })
      i = j
    }
  }

  return grouped
}

function computeDiff(text1: string, text2: string): DiffResult[] {
  const n1 = normalizeText(text1)
  const n2 = normalizeText(text2)

  let tokens1: string[]
  let tokens2: string[]

  if (wordLevel.value) {
    tokens1 = n1.split(/(\s+|[.,!?;:()[\]{}'"—–-])/).filter((w) => w.length > 0)
    tokens2 = n2.split(/(\s+|[.,!?;:()[\]{}'"—–-])/).filter((w) => w.length > 0)
  } else {
    tokens1 = [...n1]
    tokens2 = [...n2]
  }

  const raw = lcs(tokens1, tokens2)
  return groupDiffs(raw)
}

// --- Interactions ---
function setDiffRef(index: number, el: Element | ComponentPublicInstance | null) {
  diffRefs[index] = el as HTMLElement | null
}

function handleChangeClick(diffIndex: number) {
  highlightedChange.value = diffIndex
  const el = diffRefs[diffIndex]
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('diff-flash')
    setTimeout(() => el.classList.remove('diff-flash'), 2000)
  }
}

function handleDiffClick(diffIndex: number) {
  highlightedChange.value = diffIndex
  const sidebarEl = document.getElementById(`change-item-${diffIndex}`)
  sidebarEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// --- Main compare action ---
async function runComparison() {
  if (!docAFile.value || !docBFile.value) {
    error.value = 'Please select both documents'
    return
  }

  isLoading.value = true
  error.value = ''
  diffResults.value = []

  try {
    const [a, b] = await Promise.all([
      extractText(docAFile.value, 'Document A'),
      extractText(docBFile.value, 'Document B'),
    ])

    textA.value = a
    textB.value = b
    extractionProgress.value = 'Computing diff...'

    const diffs = computeDiff(a, b)
    diffResults.value = diffs
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
    extractionProgress.value = ''
  }
}

function onDocAChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    docAFile.value = file
    docAName.value = file.name
  }
}

function onDocBChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    docBFile.value = file
    docBName.value = file.name
  }
}

function toggleWordLevel() {
  wordLevel.value = !wordLevel.value
  if (textA.value && textB.value) {
    const diffs = computeDiff(textA.value, textB.value)
    diffResults.value = diffs
  }
}

// Pre-load sample documents
async function loadDefaultDocuments() {
  const [resA, resB] = await Promise.all([
    fetch('/documents/text-comparison-a.pdf'),
    fetch('/documents/text-comparison-b.pdf'),
  ])
  const [blobA, blobB] = await Promise.all([resA.blob(), resB.blob()])
  docAFile.value = new File([blobA], 'text-comparison-a.pdf', { type: 'application/pdf' })
  docBFile.value = new File([blobB], 'text-comparison-b.pdf', { type: 'application/pdf' })
  docAName.value = 'text-comparison-a.pdf'
  docBName.value = 'text-comparison-b.pdf'
}

onMounted(() => {
  loadDefaultDocuments()
})

onUnmounted(() => {
  // cleanup handled per-extraction in extractText()
})
</script>

<template>
  <div class="page-layout">
    <div class="controls-bar">
      <label class="file-label">
        <span class="file-btn">Document A</span>
        <span class="file-name">{{ docAName }}</span>
        <input type="file" accept=".pdf" hidden @change="onDocAChange">
      </label>

      <label class="file-label">
        <span class="file-btn">Document B</span>
        <span class="file-name">{{ docBName }}</span>
        <input type="file" accept=".pdf" hidden @change="onDocBChange">
      </label>

      <button
        class="btn"
        :class="{ active: wordLevel }"
        @click="toggleWordLevel"
      >
        Word Level: {{ wordLevel ? 'ON' : 'OFF' }}
      </button>

      <button class="btn btn-primary" :disabled="isLoading" @click="runComparison">
        {{ isLoading ? 'Extracting...' : 'Compare' }}
      </button>

      <div class="mode-badge">Standalone Mode</div>
    </div>

    <div v-if="error" class="error-bar">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-area">
      <div class="spinner" />
      <p>{{ extractionProgress }}</p>
    </div>

    <!-- Placeholder -->
    <div v-else-if="!diffResults.length" class="diff-placeholder">
      <p>Select two PDF documents and click Compare</p>
      <p class="hint">Extracts full text using headless viewers, then performs cross-page diff</p>
    </div>

    <!-- Results -->
    <template v-else>
      <!-- Header bar with char counts -->
      <div class="results-header">
        <div class="results-title">
          <h2>Text Comparison Results</h2>
          <span class="results-subtitle">Complete text document comparison</span>
        </div>
        <div class="char-counts">
          <div class="char-count">
            <span class="char-count-num">{{ textA.length }}</span>
            <span class="char-count-label">Doc 1 chars</span>
          </div>
          <div class="char-count">
            <span class="char-count-num">{{ textB.length }}</span>
            <span class="char-count-label">Doc 2 chars</span>
          </div>
        </div>
      </div>

      <div class="results-body">
        <!-- Sidebar: changes list -->
        <aside class="changes-sidebar">
          <div class="changes-header">
            <h3>Changes</h3>
            <table class="changes-summary-table">
              <tr>
                <td>Total changes:</td>
                <td class="changes-num">{{ changeItems.length }}</td>
              </tr>
              <tr>
                <td>Inserted:</td>
                <td class="changes-num inserted">{{ changeItems.filter(c => c.type === 'inserted').length }}</td>
              </tr>
              <tr>
                <td>Deleted:</td>
                <td class="changes-num deleted">{{ changeItems.filter(c => c.type === 'deleted').length }}</td>
              </tr>
              <tr>
                <td>Replaced:</td>
                <td class="changes-num replaced">{{ changeItems.filter(c => c.type === 'replaced').length }}</td>
              </tr>
            </table>
          </div>

          <div class="changes-list">
            <button
              v-for="(item, i) in changeItems"
              :key="item.diffIndex"
              :id="`change-item-${item.diffIndex}`"
              class="change-item"
              :class="[item.type, { highlighted: highlightedChange === item.diffIndex }]"
              @click="handleChangeClick(item.diffIndex)"
            >
              <span class="change-number">{{ i + 1 }}.</span>
              <span class="change-badge" :class="item.type">{{ item.type.toUpperCase() }}</span>
              <span class="change-preview">{{ item.preview }}</span>
            </button>
          </div>
        </aside>

        <!-- Main: summary + unified diff -->
        <div class="main-content">
          <!-- Change Summary -->
          <div class="change-summary">
            <div class="summary-stat">
              <span class="summary-num inserted">+{{ stats.additions }}</span>
              <span class="summary-label">words added</span>
            </div>
            <div class="summary-stat">
              <span class="summary-num deleted">-{{ stats.deletions }}</span>
              <span class="summary-label">words removed</span>
            </div>
            <div class="summary-stat">
              <span class="summary-num replaced">{{ stats.replacements }}</span>
              <span class="summary-label">replacements</span>
            </div>
            <div class="summary-stat">
              <span class="summary-num">{{ stats.unchanged }}</span>
              <span class="summary-label">words unchanged</span>
            </div>
            <div class="summary-percent">{{ stats.changedPercent.toFixed(1) }}% changed</div>
          </div>

          <!-- Unified Comparison View -->
          <div class="unified-view">
            <h3>Unified Comparison View</h3>
            <div class="diff-content">
              <template v-for="(item, index) in diffResults" :key="index">
                <span v-if="item.type === 'equal'" class="diff-equal">{{ item.text }}</span>
                <span
                  v-else-if="item.type === 'insert'"
                  :ref="(el) => setDiffRef(index, el)"
                  class="diff-insert"
                  role="button"
                  @click="handleDiffClick(index)"
                >{{ item.text }}</span>
                <span
                  v-else-if="item.type === 'delete'"
                  :ref="(el) => setDiffRef(index, el)"
                  class="diff-delete"
                  role="button"
                  @click="handleDiffClick(index)"
                >{{ item.text }}</span>
                <span
                  v-else-if="item.type === 'replace'"
                  :ref="(el) => setDiffRef(index, el)"
                  class="diff-replace"
                  role="button"
                  @click="handleDiffClick(index)"
                >
                  <span class="diff-replace-del">{{ item.text.split('\u2192')[0] }}</span>
                  <span class="diff-replace-ins">{{ item.text.split('\u2192')[1] }}</span>
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.controls-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.file-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.file-btn {
  padding: 6px 12px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  white-space: nowrap;
}

.file-btn:hover {
  background: #f0f0f0;
}

.file-name {
  font-size: 12px;
  color: #666;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn {
  padding: 6px 14px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover { background: #f5f5f5; }

.btn.active {
  background: #1565c0;
  color: #fff;
  border-color: #1565c0;
}

.btn-primary {
  background: #1565c0;
  color: #fff;
  border-color: #1565c0;
}

.btn-primary:hover { background: #0d47a1; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.mode-badge {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 12px;
  background: #e8f5e9;
  color: #2e7d32;
  font-weight: 500;
}

.error-bar {
  padding: 8px 16px;
  font-size: 12px;
  background: #ffebee;
  color: #c62828;
  border-bottom: 1px solid #ef9a9a;
}

/* Loading */
.loading-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #666;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e0e0e0;
  border-top-color: #1565c0;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.diff-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #999;
}

.diff-placeholder p { font-size: 16px; }

.diff-placeholder .hint {
  font-size: 13px;
  margin-top: 4px;
  color: #bbb;
}

/* Results header */
.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: #1b5e20;
  color: #fff;
  flex-shrink: 0;
}

.results-title h2 {
  font-size: 18px;
  margin: 0;
}

.results-subtitle {
  font-size: 12px;
  opacity: 0.8;
}

.char-counts {
  display: flex;
  gap: 20px;
}

.char-count {
  text-align: right;
}

.char-count-num {
  display: block;
  font-size: 20px;
  font-weight: 700;
}

.char-count-label {
  font-size: 11px;
  opacity: 0.8;
}

/* Results body: sidebar + main */
.results-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.changes-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.changes-header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
}

.changes-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 8px;
}

.changes-summary-table {
  font-size: 13px;
  width: 100%;
}

.changes-summary-table td {
  padding: 2px 0;
}

.changes-num {
  text-align: right;
  font-weight: 600;
}

.changes-num.inserted { color: #2e7d32; }
.changes-num.deleted { color: #c62828; }
.changes-num.replaced { color: #e65100; }

.changes-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.change-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  transition: all 0.15s;
}

.change-item:hover { background: #f5f5f5; }

.change-item.highlighted {
  border-color: #1565c0;
  box-shadow: 0 0 0 2px rgba(21, 101, 192, 0.2);
}

.change-number {
  color: #999;
  font-weight: 500;
  flex-shrink: 0;
}

.change-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  text-transform: uppercase;
}

.change-badge.inserted { background: #c8e6c9; color: #1b5e20; }
.change-badge.deleted { background: #ffcdd2; color: #b71c1c; }
.change-badge.replaced { background: #fff3e0; color: #e65100; }

.change-preview {
  font-family: monospace;
  font-size: 11px;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Main content */
.main-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Change Summary */
.change-summary {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  background: #fafafa;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.summary-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.summary-num {
  font-size: 20px;
  font-weight: 700;
}

.summary-num.inserted { color: #2e7d32; }
.summary-num.deleted { color: #c62828; }
.summary-num.replaced { color: #e65100; }

.summary-label {
  font-size: 11px;
  color: #888;
}

.summary-percent {
  margin-left: auto;
  font-size: 13px;
  color: #666;
}

/* Unified diff view */
.unified-view {
  padding: 20px;
  flex: 1;
}

.unified-view h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px;
}

.diff-content {
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
}

.diff-equal { color: #333; }

.diff-insert {
  background: #c8e6c9;
  color: #1b5e20;
  border-bottom: 2px solid #66bb6a;
  padding: 0 2px;
  cursor: pointer;
}

.diff-delete {
  background: #ffcdd2;
  color: #b71c1c;
  text-decoration: line-through;
  border-bottom: 2px solid #ef5350;
  padding: 0 2px;
  cursor: pointer;
}

.diff-replace {
  padding: 0 1px;
  cursor: pointer;
}

.diff-replace-del {
  background: #ffcdd2;
  color: #b71c1c;
  text-decoration: line-through;
  padding: 0 2px;
}

.diff-replace-ins {
  background: #c8e6c9;
  color: #1b5e20;
  padding: 0 2px;
}

/* Flash animation for scroll-to highlight */
.diff-flash {
  outline: 3px solid #42a5f5;
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
