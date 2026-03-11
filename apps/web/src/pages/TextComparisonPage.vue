<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { getNutrientViewer, baseUrl, licenseKey } from '@/nutrient'
import type NutrientViewerType from '@nutrient-sdk/viewer'

const containerEl = ref<HTMLElement | null>(null)
const wordLevel = ref(true)
const containerKey = ref(0)
const isLoading = ref(false)
const error = ref<string>('')
let sdk: typeof NutrientViewerType | null = null

const docAName = ref('LeaseContract.docx')
const docBName = ref('LeaseContract3.docx')
const docABuffer = ref<ArrayBuffer | null>(null)
const docBBuffer = ref<ArrayBuffer | null>(null)

// Auto-load default documents
async function loadDefaults() {
  const [respA, respB] = await Promise.all([
    fetch('/documents/LeaseContract.docx'),
    fetch('/documents/LeaseContract3.docx'),
  ])
  docABuffer.value = await respA.arrayBuffer()
  docBBuffer.value = await respB.arrayBuffer()
  docAName.value = 'LeaseContract.docx'
  docBName.value = 'LeaseContract3.docx'
}

async function loadComparison() {
  if (!containerEl.value) return

  const bufA = docABuffer.value
  const bufB = docBBuffer.value
  if (!bufA || !bufB) {
    error.value = 'Please select both Document A and Document B'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const SDK = await getNutrientViewer()
    sdk = SDK

    // Unload previous instance
    try {
      SDK.unload(containerEl.value)
    } catch {
      // No previous instance
    }

    const bufferA = bufA.slice(0)
    const bufferB = bufB.slice(0)

    await SDK.loadTextComparison({
      container: containerEl.value,
      documentA: bufferA,
      documentB: bufferB,
      wordLevel: wordLevel.value,
      baseUrl,
      licenseKey,
      toolbarItems: SDK.defaultTextComparisonToolbarItems,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
  }
}

async function toggleWordLevel() {
  if (containerEl.value) {
    try {
      const SDK = await getNutrientViewer()
      SDK.unload(containerEl.value)
    } catch {
      // ignore
    }
  }
  wordLevel.value = !wordLevel.value
  containerKey.value++
  if (docABuffer.value && docBBuffer.value) {
    await nextTick()
    loadComparison()
  }
}

onMounted(async () => {
  await loadDefaults()
  loadComparison()
})

onBeforeUnmount(() => {
  if (sdk && containerEl.value) {
    try { sdk.unload(containerEl.value) } catch { /* ignore */ }
  }
})
</script>

<template>
  <div class="page-layout">
    <div class="controls-bar">
      <span class="doc-names">{{ docAName }} vs {{ docBName }}</span>

      <button
        class="btn"
        :class="{ active: wordLevel }"
        @click="toggleWordLevel"
      >
        Word Level: {{ wordLevel ? 'ON' : 'OFF' }}
      </button>

      <button class="btn btn-primary" :disabled="isLoading" @click="loadComparison">
        {{ isLoading ? 'Loading...' : 'Compare' }}
      </button>

      <div class="mode-badge">Standalone Mode</div>
    </div>

    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="viewer-area">
      <div v-if="!docABuffer && !docBBuffer" class="viewer-placeholder">
        <p>Select two documents to compare</p>
        <p class="hint">Uses NutrientViewer.loadTextComparison() — standalone mode, no server required</p>
      </div>
      <div ref="containerEl" :key="containerKey" class="viewer-container" />
    </div>
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

.doc-names {
  font-size: 12px;
  color: #555;
  font-weight: 500;
}

.btn {
  padding: 6px 14px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn:hover {
  background: #f5f5f5;
}

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

.btn-primary:hover {
  background: #0d47a1;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

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

.viewer-area {
  flex: 1;
  position: relative;
}

.viewer-container {
  width: 100%;
  height: 100%;
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
