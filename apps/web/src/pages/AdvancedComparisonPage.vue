<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getNutrientViewer, baseUrl, licenseKey } from '@/nutrient'
import type NutrientViewerType from '@nutrient-sdk/viewer'

// --- Types ---
interface TextLineInfo {
  contents: string
  pageIndex: number
  rect: { left: number; top: number; width: number; height: number }
}

interface IndexedDiff {
  type: 'equal' | 'insert' | 'delete'
  text: string
  indexA: number // index into linesA (-1 for insert)
  indexB: number // index into linesB (-1 for delete)
}

interface ChangeGroup {
  type: 'inserted' | 'deleted' | 'replaced' | 'moved'
  preview: string
  pageA?: number
  pageB?: number
  linesA: number[]
  linesB: number[]
  moveId?: number
}

// --- State ---
const isLoading = ref(false)
const progress = ref('')
const error = ref('')
const hasResults = ref(false)

const docAFile = ref<File | null>(null)
const docBFile = ref<File | null>(null)
const docAName = ref('(select Document A)')
const docBName = ref('(select Document B)')

const containerA = ref<HTMLElement | null>(null)
const containerB = ref<HTMLElement | null>(null)

let SDK: typeof NutrientViewerType | null = null
let instA: any = null
let instB: any = null

const changeGroups = ref<ChangeGroup[]>([])
const highlightedIndex = ref<number | null>(null)

// --- Computed ---
const stats = computed(() => {
  const groups = changeGroups.value
  return {
    inserted: groups.filter(g => g.type === 'inserted').length,
    deleted: groups.filter(g => g.type === 'deleted').length,
    replaced: groups.filter(g => g.type === 'replaced').length,
    moved: groups.filter(g => g.type === 'moved').length,
    total: groups.length,
  }
})

// --- Lifecycle ---
onMounted(async () => {
  await loadDefaultDocuments()
  runComparison()
})

onUnmounted(async () => {
  await cleanup()
})

async function cleanup() {
  try {
    if (!SDK) SDK = await getNutrientViewer()
    if (instA && containerA.value) { SDK.unload(containerA.value); instA = null }
    if (instB && containerB.value) { SDK.unload(containerB.value); instB = null }
  } catch { /* ignore */ }
}

async function loadDefaultDocuments() {
  const [resA, resB] = await Promise.all([
    fetch('/documents/LeaseContract.docx'),
    fetch('/documents/LeaseContract3.docx'),
  ])
  const [blobA, blobB] = await Promise.all([resA.blob(), resB.blob()])
  docAFile.value = new File([blobA], 'LeaseContract.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  docBFile.value = new File([blobB], 'LeaseContract3.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  docAName.value = 'LeaseContract.docx'
  docBName.value = 'LeaseContract3.docx'
}

function onDocAChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) { docAFile.value = file; docAName.value = file.name }
}

function onDocBChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) { docBFile.value = file; docBName.value = file.name }
}

// --- Text extraction with position info ---
async function extractLines(instance: any): Promise<TextLineInfo[]> {
  const lines: TextLineInfo[] = []
  const pageCount = instance.totalPageCount
  for (let p = 0; p < pageCount; p++) {
    const textLines = await instance.textLinesForPageIndex(p)
    for (const tl of textLines) {
      lines.push({
        contents: tl.contents,
        pageIndex: p,
        rect: {
          left: tl.boundingBox.left,
          top: tl.boundingBox.top,
          width: tl.boundingBox.width,
          height: tl.boundingBox.height,
        },
      })
    }
  }
  return lines
}

// --- Diff algorithm (line-level LCS with index tracking) ---
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    // Collapse spaces around punctuation so "Corp ." → "Corp." and "XR -900" → "XR-900"
    .replace(/\s+([.,;:!?\-\)\]"])/g, '$1')
    .replace(/([\(\["])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function lcsWithIndices(arr1: string[], arr2: string[]): IndexedDiff[] {
  const m = arr1.length
  const n = arr2.length

  // For large inputs, use hash-based fallback
  if (m * n > 25_000_000) {
    return hashDiffWithIndices(arr1, arr2)
  }

  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  const result: IndexedDiff[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && arr1[i - 1] === arr2[j - 1]) {
      result.unshift({ type: 'equal', text: arr1[i - 1]!, indexA: i - 1, indexB: j - 1 })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.unshift({ type: 'insert', text: arr2[j - 1]!, indexA: -1, indexB: j - 1 })
      j--
    } else if (i > 0) {
      result.unshift({ type: 'delete', text: arr1[i - 1]!, indexA: i - 1, indexB: -1 })
      i--
    }
  }
  return result
}

function hashDiffWithIndices(arr1: string[], arr2: string[]): IndexedDiff[] {
  const map2 = new Map<string, number[]>()
  for (let j = 0; j < arr2.length; j++) {
    const key = arr2[j]!
    if (!map2.has(key)) map2.set(key, [])
    map2.get(key)!.push(j)
  }

  const result: IndexedDiff[] = []
  const usedJ = new Set<number>()
  let lastJ = -1

  for (let i = 0; i < arr1.length; i++) {
    const indices = map2.get(arr1[i]!)
    if (indices) {
      const idx = indices.find(j => j > lastJ && !usedJ.has(j))
      if (idx !== undefined) {
        for (let k = lastJ + 1; k < idx; k++) {
          if (!usedJ.has(k)) {
            result.push({ type: 'insert', text: arr2[k]!, indexA: -1, indexB: k })
            usedJ.add(k)
          }
        }
        result.push({ type: 'equal', text: arr1[i]!, indexA: i, indexB: idx })
        usedJ.add(idx)
        lastJ = idx
        continue
      }
    }
    result.push({ type: 'delete', text: arr1[i]!, indexA: i, indexB: -1 })
  }

  for (let j = lastJ + 1; j < arr2.length; j++) {
    if (!usedJ.has(j)) {
      result.push({ type: 'insert', text: arr2[j]!, indexA: -1, indexB: j })
    }
  }
  return result
}

// --- Move detection ---
function textSimilarity(a: string, b: string): number {
  const na = a.trim().toLowerCase()
  const nb = b.trim().toLowerCase()
  if (na === nb) return 1.0
  if (na.length === 0 || nb.length === 0) return 0
  const wordsA = new Set(na.split(/\s+/))
  const wordsB = new Set(nb.split(/\s+/))
  let intersection = 0
  for (const w of wordsA) if (wordsB.has(w)) intersection++
  const union = wordsA.size + wordsB.size - intersection
  return union > 0 ? intersection / union : 0
}

// --- Build change groups from raw diffs ---
function buildChangeGroups(
  diffs: IndexedDiff[],
  linesA: TextLineInfo[],
  linesB: TextLineInfo[],
): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  let i = 0

  while (i < diffs.length) {
    const d = diffs[i]!
    if (d.type === 'equal') { i++; continue }

    if (d.type === 'delete') {
      // Collect consecutive deletes
      const deleteRun: IndexedDiff[] = []
      while (i < diffs.length && diffs[i]!.type === 'delete') {
        deleteRun.push(diffs[i]!)
        i++
      }
      // Check if followed by inserts (replacement)
      const insertRun: IndexedDiff[] = []
      while (i < diffs.length && diffs[i]!.type === 'insert') {
        insertRun.push(diffs[i]!)
        i++
      }

      if (insertRun.length > 0) {
        const delText = deleteRun.map(d => d.text).join(' ')
        const insText = insertRun.map(d => d.text).join(' ')
        groups.push({
          type: 'replaced',
          preview: `${delText.slice(0, 30)} \u2192 ${insText.slice(0, 30)}`,
          pageA: linesA[deleteRun[0]!.indexA]?.pageIndex,
          pageB: linesB[insertRun[0]!.indexB]?.pageIndex,
          linesA: [...new Set(deleteRun.map(d => d.indexA))],
          linesB: [...new Set(insertRun.map(d => d.indexB))],
        })
      } else {
        const delText = deleteRun.map(d => d.text).join(' ')
        groups.push({
          type: 'deleted',
          preview: delText.slice(0, 60),
          pageA: linesA[deleteRun[0]!.indexA]?.pageIndex,
          linesA: [...new Set(deleteRun.map(d => d.indexA))],
          linesB: [],
        })
      }
    } else if (d.type === 'insert') {
      const insertRun: IndexedDiff[] = []
      while (i < diffs.length && diffs[i]!.type === 'insert') {
        insertRun.push(diffs[i]!)
        i++
      }
      const insText = insertRun.map(d => d.text).join(' ')
      groups.push({
        type: 'inserted',
        preview: insText.slice(0, 60),
        pageB: linesB[insertRun[0]!.indexB]?.pageIndex,
        linesA: [],
        linesB: [...new Set(insertRun.map(d => d.indexB))],
      })
    }
  }

  // Detect page-moves: "equal" lines where the page changed between doc A and doc B.
  // Group consecutive page-moved equal lines into a single "moved" change group.
  let moveId = 0
  let pageMovedRun: IndexedDiff[] = []

  const flushPageMoved = () => {
    if (pageMovedRun.length === 0) return
    const text = pageMovedRun.map(d => d.text).join(' ')
    const firstA = linesA[pageMovedRun[0]!.indexA]!
    const firstB = linesB[pageMovedRun[0]!.indexB]!
    const currentMoveId = moveId++
    groups.push({
      type: 'moved',
      preview: `p${firstA.pageIndex + 1}\u2192p${firstB.pageIndex + 1}: ${text.slice(0, 50)}`,
      pageA: firstA.pageIndex,
      pageB: firstB.pageIndex,
      linesA: pageMovedRun.map(d => d.indexA),
      linesB: pageMovedRun.map(d => d.indexB),
      moveId: currentMoveId,
    })
    pageMovedRun = []
  }

  for (const d of diffs) {
    if (d.type !== 'equal' || d.indexA < 0 || d.indexB < 0) {
      flushPageMoved()
      continue
    }
    const lineA = linesA[d.indexA]
    const lineB = linesB[d.indexB]
    if (lineA && lineB && lineA.pageIndex !== lineB.pageIndex) {
      pageMovedRun.push(d)
    } else {
      flushPageMoved()
    }
  }
  flushPageMoved()

  // Move detection among delete/insert groups
  const SIMILARITY_THRESHOLD = 0.6
  const MIN_LENGTH = 20
  const matchedInserts = new Set<number>()

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!
    if (g.type !== 'deleted') continue
    if (g.preview.length < MIN_LENGTH) continue

    let bestScore = 0
    let bestIdx = -1
    for (let gj = 0; gj < groups.length; gj++) {
      if (matchedInserts.has(gj)) continue
      const g2 = groups[gj]!
      if (g2.type !== 'inserted') continue
      if (g2.preview.length < MIN_LENGTH) continue
      const score = textSimilarity(g.preview, g2.preview)
      if (score > bestScore) { bestScore = score; bestIdx = gj }
    }

    if (bestScore >= SIMILARITY_THRESHOLD && bestIdx >= 0) {
      matchedInserts.add(bestIdx)
      const currentMoveId = moveId++
      g.type = 'moved'
      g.moveId = currentMoveId
      g.pageB = groups[bestIdx]!.pageB
      g.linesB = groups[bestIdx]!.linesB

      groups[bestIdx]!.type = 'moved'
      groups[bestIdx]!.moveId = currentMoveId
      groups[bestIdx]!.pageA = g.pageA
      groups[bestIdx]!.linesA = g.linesA
    }
  }

  return groups
}

// --- Create highlight annotations on the rendered documents ---
async function createHighlights(
  groups: ChangeGroup[],
  linesA: TextLineInfo[],
  linesB: TextLineInfo[],
  changedRangesA: Map<number, { fracStart: number; fracEnd: number }[]>,
  changedRangesB: Map<number, { fracStart: number; fracEnd: number }[]>,
) {
  if (!SDK) return

  const PADDING = 4 // PDF points of horizontal padding
  const FULL_LINE_EXTEND = 0.12 // extend full-line highlights by 12% to cover text overflow

  const COLOR_DELETED = { r: 255, g: 100, b: 100 }
  const COLOR_INSERTED = { r: 100, g: 200, b: 100 }
  const COLOR_REPLACED_A = { r: 255, g: 165, b: 50 }
  const COLOR_REPLACED_B = { r: 255, g: 200, b: 50 }
  const COLOR_MOVED_A = { r: 180, g: 130, b: 220 }
  const COLOR_MOVED_B = { r: 130, g: 150, b: 220 }

  // Pad a rect — full-line rects get extra width to cover text overflow from bounding box
  function padRect(r: { left: number; top: number; width: number; height: number }, fullLine = false) {
    // For full lines: extend by a percentage OR a minimum absolute amount, whichever is larger.
    // This handles narrow bounding boxes (e.g. short signature lines) where % alone isn't enough.
    const extra = fullLine ? Math.max(r.width * FULL_LINE_EXTEND, 12) : 0
    // Enforce minimum height — text extraction can return near-zero height for some lines
    // (e.g. underscore signature lines: h=0.8). Center the expansion vertically.
    let { top, height } = r
    const MIN_HEIGHT = 10
    if (height < MIN_HEIGHT) {
      top -= (MIN_HEIGHT - height) / 2
      height = MIN_HEIGHT
    }
    return { left: r.left - PADDING, top, width: r.width + PADDING * 2 + extra, height }
  }

  // Compute highlight rects for a line, using word-level sub-rects when available
  function computeRects(
    line: TextLineInfo,
    ranges: { fracStart: number; fracEnd: number }[] | undefined,
  ) {
    if (!ranges || ranges.length === 0) {
      return [padRect(line.rect, true)]
    }

    // Sort and merge overlapping/adjacent ranges
    const sorted = [...ranges].sort((a, b) => a.fracStart - b.fracStart)
    const merged: { fracStart: number; fracEnd: number }[] = []
    for (const r of sorted) {
      const last = merged[merged.length - 1]
      if (last && r.fracStart <= last.fracEnd + 0.03) {
        last.fracEnd = Math.max(last.fracEnd, r.fracEnd)
      } else {
        merged.push({ ...r })
      }
    }

    // If coverage > 80%, highlight the full line
    const totalCoverage = merged.reduce((s, r) => s + (r.fracEnd - r.fracStart), 0)
    if (totalCoverage > 0.8) {
      return [padRect(line.rect, true)]
    }

    // Drop sub-rects that are too narrow (< 3% of line width).
    // HighlightAnnotation snaps to text, so very narrow rects at imprecise
    // proportional-font positions cause false highlights on nearby words.
    // The change is still visible from highlights on adjacent lines.
    const reliable = merged.filter(r => (r.fracEnd - r.fracStart) >= 0.03)
    if (reliable.length === 0) return []

    // Create sub-rects proportionally within the line's bounding box
    return reliable.map(r => {
      const left = line.rect.left + r.fracStart * line.rect.width
      const width = (r.fracEnd - r.fracStart) * line.rect.width
      return padRect({ left, top: line.rect.top, width, height: line.rect.height })
    })
  }

  // Build per-line info: color + whether to use word-level sub-rects
  const lineAInfo = new Map<number, { color: { r: number; g: number; b: number }; useSubRects: boolean }>()
  const lineBInfo = new Map<number, { color: { r: number; g: number; b: number }; useSubRects: boolean }>()

  for (const g of groups) {
    let colorA: { r: number; g: number; b: number } | null = null
    let colorB: { r: number; g: number; b: number } | null = null
    const useSubRects = g.type === 'replaced'

    switch (g.type) {
      case 'deleted': colorA = COLOR_DELETED; break
      case 'inserted': colorB = COLOR_INSERTED; break
      case 'replaced': colorA = COLOR_REPLACED_A; colorB = COLOR_REPLACED_B; break
      case 'moved': colorA = COLOR_MOVED_A; colorB = COLOR_MOVED_B; break
    }

    if (colorA) for (const idx of g.linesA) if (idx >= 0) lineAInfo.set(idx, { color: colorA, useSubRects })
    if (colorB) for (const idx of g.linesB) if (idx >= 0) lineBInfo.set(idx, { color: colorB, useSubRects })
  }

  // Helper: create annotation on an instance
  async function annotate(
    inst: any,
    docLabel: string,
    lines: TextLineInfo[],
    lineInfo: Map<number, { color: { r: number; g: number; b: number }; useSubRects: boolean }>,
    rangesMap: Map<number, { fracStart: number; fracEnd: number }[]>,
  ) {
    for (const [idx, info] of lineInfo) {
      const line = lines[idx]
      if (!line) continue
      try {
        const ranges = info.useSubRects ? rangesMap.get(idx) : undefined
        const rects = computeRects(line, ranges)
        if (rects.length === 0) continue // Skip — sub-rect too narrow for reliable highlighting

        // Debug: log highlight details
        if (info.useSubRects && ranges) {
          console.log(`  [HIGHLIGHT ${docLabel}] line ${idx} sub-rects: text="${line.contents.slice(0, 50)}" ranges=${JSON.stringify(ranges.map(r => ({s: r.fracStart.toFixed(3), e: r.fracEnd.toFixed(3)})))} lineRect={l:${line.rect.left.toFixed(1)}, w:${line.rect.width.toFixed(1)}} → ${rects.length} rect(s)`)
        }
        // Log bounding boxes for moved lines to diagnose coverage
        if (!info.useSubRects) {
          console.log(`  [HIGHLIGHT ${docLabel}] line ${idx} full: text="${line.contents.slice(0, 40)}" bbox={l:${line.rect.left.toFixed(1)}, t:${line.rect.top.toFixed(1)}, w:${line.rect.width.toFixed(1)}, h:${line.rect.height.toFixed(1)}} → final w:${rects[0]!.width.toFixed(1)}`)
        }

        const sdkRects = rects.map(r => new SDK!.Geometry.Rect(r))
        const bbox = {
          left: Math.min(...rects.map(r => r.left)),
          top: Math.min(...rects.map(r => r.top)),
          width: 0, height: 0,
        }
        bbox.width = Math.max(...rects.map(r => r.left + r.width)) - bbox.left
        bbox.height = Math.max(...rects.map(r => r.top + r.height)) - bbox.top

        const annotation = new SDK!.Annotations.HighlightAnnotation({
          pageIndex: line.pageIndex,
          rects: SDK!.Immutable.List(sdkRects),
          boundingBox: new SDK!.Geometry.Rect(bbox),
          color: new SDK!.Color(info.color),
          opacity: 0.35,
          isEditable: false,
        })
        await inst.create(annotation)
      } catch (e) {
        console.warn('Annotation failed:', e)
      }
    }
  }

  // Log highlight plan for moved groups
  for (const g of groups) {
    if (g.type === 'moved') {
      const uniqueB = [...new Set(g.linesB)]
      console.log(`  [HIGHLIGHT moved] Doc B lines: ${uniqueB.map(i => `${i}:"${linesB[i]?.contents.slice(0, 40)}"`).join(', ')}`)
    }
  }

  await annotate(instA, 'DocA', linesA, lineAInfo, changedRangesA)
  await annotate(instB, 'DocB', linesB, lineBInfo, changedRangesB)
}

// --- Navigate to a change ---
function navigateToChange(index: number) {
  highlightedIndex.value = index
  const group = changeGroups.value[index]
  if (!group) return

  if (group.pageA != null && instA) {
    instA.setViewState((vs: any) => vs.set('currentPageIndex', group.pageA))
  }
  if (group.pageB != null && instB) {
    instB.setViewState((vs: any) => vs.set('currentPageIndex', group.pageB))
  }
}

// --- Main compare action ---
async function runComparison() {
  if (!docAFile.value || !docBFile.value) {
    error.value = 'Please select both documents'
    return
  }

  isLoading.value = true
  error.value = ''
  changeGroups.value = []
  hasResults.value = false

  try {
    SDK = await getNutrientViewer()

    // Cleanup previous instances
    await cleanup()

    // Load both documents in visible viewers
    progress.value = 'Loading documents...'
    const [bufA, bufB] = await Promise.all([
      docAFile.value.arrayBuffer(),
      docBFile.value.arrayBuffer(),
    ])

    // Load sequentially (parallel can cause issues with shared WASM)
    instA = await SDK.load({
      container: containerA.value!,
      document: bufA,
      baseUrl,
      licenseKey,
      toolbarItems: [],
    })

    instB = await SDK.load({
      container: containerB.value!,
      document: bufB,
      baseUrl,
      licenseKey,
      toolbarItems: [],
    })

    // Extract text lines with positions from the visible instances
    progress.value = 'Extracting text from Document A...'
    const linesA = await extractLines(instA)
    progress.value = 'Extracting text from Document B...'
    const linesB = await extractLines(instB)

    // Build word arrays with line-index tracking.
    // This avoids false diffs caused by the same text being split across
    // different line breaks in the two PDFs.
    interface WordWithLine { word: string; lineIdx: number; fracStart: number; fracEnd: number }
    const wordsA: WordWithLine[] = []
    const wordsB: WordWithLine[] = []

    for (let i = 0; i < linesA.length; i++) {
      const normalized = normalize(linesA[i]!.contents)
      const words = normalized.split(/\s+/).filter(w => w)
      const nLen = normalized.length
      let sf = 0
      for (const w of words) {
        const idx = normalized.indexOf(w, sf)
        const fracStart = nLen > 0 ? idx / nLen : 0
        const fracEnd = nLen > 0 ? (idx + w.length) / nLen : 1
        wordsA.push({ word: w, lineIdx: i, fracStart, fracEnd })
        sf = idx + w.length
      }
    }
    for (let i = 0; i < linesB.length; i++) {
      const normalized = normalize(linesB[i]!.contents)
      const words = normalized.split(/\s+/).filter(w => w)
      const nLen = normalized.length
      let sf = 0
      for (const w of words) {
        const idx = normalized.indexOf(w, sf)
        const fracStart = nLen > 0 ? idx / nLen : 0
        const fracEnd = nLen > 0 ? (idx + w.length) / nLen : 1
        wordsB.push({ word: w, lineIdx: i, fracStart, fracEnd })
        sf = idx + w.length
      }
    }

    // Merge punctuation-only tokens with the previous word ACROSS lines.
    // Text extraction can split "Inc.," across two lines: line N = "Inc"
    // and line N+1 = "., having..." — the ".," needs to attach to "Inc".
    function mergeGlobalPunctuation(words: WordWithLine[]) {
      for (let i = words.length - 1; i >= 1; i--) {
        if (/^[.,;:!?\-\)\]"]+$/.test(words[i]!.word)) {
          words[i - 1]!.word += words[i]!.word
          // Extend fracEnd if on the same line
          if (words[i - 1]!.lineIdx === words[i]!.lineIdx) {
            words[i - 1]!.fracEnd = words[i]!.fracEnd
          }
          words.splice(i, 1)
        }
      }
    }
    mergeGlobalPunctuation(wordsA)
    mergeGlobalPunctuation(wordsB)

    // Run LCS diff at word level
    progress.value = `Computing diff (${wordsA.length} vs ${wordsB.length} words)...`
    await new Promise(r => setTimeout(r, 50)) // yield to UI

    const rawDiffs = lcsWithIndices(
      wordsA.map(w => w.word),
      wordsB.map(w => w.word),
    )

    // Build per-line changed character ranges for word-level sub-rect highlighting
    const changedRangesA = new Map<number, { fracStart: number; fracEnd: number }[]>()
    const changedRangesB = new Map<number, { fracStart: number; fracEnd: number }[]>()
    for (const d of rawDiffs) {
      if (d.type === 'equal') continue
      if (d.type === 'delete' && d.indexA >= 0) {
        const w = wordsA[d.indexA]!
        if (!changedRangesA.has(w.lineIdx)) changedRangesA.set(w.lineIdx, [])
        changedRangesA.get(w.lineIdx)!.push({ fracStart: w.fracStart, fracEnd: w.fracEnd })
      }
      if (d.type === 'insert' && d.indexB >= 0) {
        const w = wordsB[d.indexB]!
        if (!changedRangesB.has(w.lineIdx)) changedRangesB.set(w.lineIdx, [])
        changedRangesB.get(w.lineIdx)!.push({ fracStart: w.fracStart, fracEnd: w.fracEnd })
      }
    }

    // Map word indices back to line indices
    const mappedDiffs: IndexedDiff[] = rawDiffs.map(d => ({
      ...d,
      indexA: d.indexA >= 0 ? wordsA[d.indexA]!.lineIdx : -1,
      indexB: d.indexB >= 0 ? wordsB[d.indexB]!.lineIdx : -1,
    }))

    // Build change groups with move detection
    progress.value = 'Detecting changes and moves...'
    const groups = buildChangeGroups(mappedDiffs, linesA, linesB)
    changeGroups.value = groups

    // Create highlight annotations on the rendered documents
    progress.value = 'Highlighting changes...'
    await createHighlights(groups, linesA, linesB, changedRangesA, changedRangesB)

    hasResults.value = true

    // Log detailed diff results
    console.log('=== Advanced Comparison Results ===')
    console.log(`Lines extracted: Doc A = ${linesA.length}, Doc B = ${linesB.length}`)
    console.log(`Words: Doc A = ${wordsA.length}, Doc B = ${wordsB.length}`)
    console.log(`Raw word diffs: ${rawDiffs.length} entries (${rawDiffs.filter(d => d.type === 'equal').length} equal, ${rawDiffs.filter(d => d.type === 'delete').length} delete, ${rawDiffs.filter(d => d.type === 'insert').length} insert)`)
    console.log(`Change groups: ${groups.length} total`)
    groups.forEach((g, i) => {
      const pagesInfo = [
        g.pageA != null ? `docA p${g.pageA + 1}` : null,
        g.pageB != null ? `docB p${g.pageB + 1}` : null,
      ].filter(Boolean).join(', ')
      const linesInfo = `linesA=[${g.linesA.join(',')}] linesB=[${g.linesB.join(',')}]`
      console.log(`  ${i + 1}. [${g.type.toUpperCase()}] ${pagesInfo} | ${linesInfo} | "${g.preview}"`)
      if (g.moveId != null) console.log(`     moveId=${g.moveId}`)
    })
    console.log('==================================')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    console.error('Comparison failed:', err)
  } finally {
    isLoading.value = false
    progress.value = ''
  }
}
</script>

<template>
  <div class="page-layout">
    <div class="controls-bar">
      <label class="file-label">
        <span class="file-btn">Document A</span>
        <span class="file-name">{{ docAName }}</span>
        <input type="file" accept=".pdf,.docx" hidden @change="onDocAChange">
      </label>

      <label class="file-label">
        <span class="file-btn">Document B</span>
        <span class="file-name">{{ docBName }}</span>
        <input type="file" accept=".pdf,.docx" hidden @change="onDocBChange">
      </label>

      <button class="btn btn-primary" :disabled="isLoading" @click="runComparison">
        {{ isLoading ? 'Analyzing...' : 'Compare' }}
      </button>

      <div class="mode-badge">Standalone + Move Detection</div>
    </div>

    <div v-if="error" class="error-bar">{{ error }}</div>

    <!-- Loading overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner" />
      <p>{{ progress }}</p>
    </div>

    <!-- Main content: sidebar + two PDF viewers -->
    <div class="comparison-body">
      <!-- Changes sidebar -->
      <aside v-if="hasResults" class="changes-sidebar">
        <div class="changes-header">
          <h3>Changes ({{ stats.total }})</h3>
          <div class="changes-stats">
            <span v-if="stats.inserted" class="stat-badge inserted">{{ stats.inserted }} inserted</span>
            <span v-if="stats.deleted" class="stat-badge deleted">{{ stats.deleted }} deleted</span>
            <span v-if="stats.replaced" class="stat-badge replaced">{{ stats.replaced }} replaced</span>
            <span v-if="stats.moved" class="stat-badge moved">{{ stats.moved }} moved</span>
          </div>
        </div>
        <div class="changes-list">
          <button
            v-for="(group, i) in changeGroups"
            :key="i"
            class="change-item"
            :class="[group.type, { highlighted: highlightedIndex === i }]"
            @click="navigateToChange(i)"
          >
            <span class="change-number">{{ i + 1 }}.</span>
            <span class="change-badge" :class="group.type">{{ group.type.toUpperCase() }}</span>
            <span class="change-preview">{{ group.preview }}</span>
            <span v-if="group.pageA != null" class="change-page">p{{ group.pageA + 1 }}</span>
          </button>
        </div>
      </aside>

      <!-- Document viewers -->
      <div class="viewers-area">
        <div class="viewer-pane">
          <div class="viewer-label">Document A</div>
          <div ref="containerA" class="viewer-container" />
        </div>
        <div class="viewer-divider" />
        <div class="viewer-pane">
          <div class="viewer-label">Document B</div>
          <div ref="containerB" class="viewer-container" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
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
  z-index: 10;
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

.file-btn:hover { background: #f0f0f0; }

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
  background: #e3f2fd;
  color: #1565c0;
  font-weight: 500;
}

.error-bar {
  padding: 8px 16px;
  font-size: 12px;
  background: #ffebee;
  color: #c62828;
  border-bottom: 1px solid #ef9a9a;
  flex-shrink: 0;
}

/* Loading overlay */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #666;
  z-index: 100;
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

/* Main layout: sidebar + viewers */
.comparison-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Changes sidebar */
.changes-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.changes-header {
  padding: 12px 14px;
  border-bottom: 1px solid #e0e0e0;
}

.changes-header h3 {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 8px;
}

.changes-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.stat-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}

.stat-badge.inserted { background: #c8e6c9; color: #1b5e20; }
.stat-badge.deleted { background: #ffcdd2; color: #b71c1c; }
.stat-badge.replaced { background: #fff3e0; color: #e65100; }
.stat-badge.moved { background: #e1bee7; color: #6a1b9a; }

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
.change-badge.moved { background: #e1bee7; color: #6a1b9a; }

.change-preview {
  font-size: 11px;
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.change-page {
  font-size: 10px;
  color: #999;
  flex-shrink: 0;
}

/* Document viewers */
.viewers-area {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.viewer-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.viewer-label {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #555;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.viewer-container {
  flex: 1;
  position: relative;
  min-height: 200px;
}

.viewer-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
}

.viewer-divider {
  width: 2px;
  background: #ccc;
  flex-shrink: 0;
}
</style>
