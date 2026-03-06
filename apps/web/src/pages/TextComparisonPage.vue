<script setup lang="ts">
import { ref, nextTick, onUnmounted } from 'vue'
import { getNutrientViewer, baseUrl } from '@/nutrient'

const containerEl = ref<HTMLElement | null>(null)
const wordLevel = ref(true)
const containerKey = ref(0)
const isLoading = ref(false)
const error = ref<string>('')

const docAFile = ref<File | null>(null)
const docBFile = ref<File | null>(null)
const docAName = ref('(select Document A)')
const docBName = ref('(select Document B)')

function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer()
}

async function loadComparison() {
  if (!containerEl.value) return
  if (!docAFile.value || !docBFile.value) {
    error.value = 'Please select both Document A and Document B'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const SDK = await getNutrientViewer()

    // Unload previous instance
    try {
      SDK.unload(containerEl.value)
    } catch {
      // No previous instance
    }

    const [bufferA, bufferB] = await Promise.all([
      fileToArrayBuffer(docAFile.value),
      fileToArrayBuffer(docBFile.value),
    ])

    await SDK.loadTextComparison({
      container: containerEl.value,
      documentA: bufferA,
      documentB: bufferB,
      wordLevel: wordLevel.value,
      baseUrl,
      toolbarItems: SDK.defaultTextComparisonToolbarItems,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isLoading.value = false
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
  if (docAFile.value && docBFile.value) {
    // Wait for Vue to recreate the container with the new key
    await nextTick()
    loadComparison()
  }
}

onUnmounted(async () => {
  if (containerEl.value) {
    try {
      const SDK = await getNutrientViewer()
      SDK.unload(containerEl.value)
    } catch {
      // ignore
    }
  }
})
</script>

<template>
  <div class="page-layout">
    <div class="controls-bar">
      <div class="control-group">
        <label class="file-label">
          <span class="file-btn">Document A</span>
          <span class="file-name">{{ docAName }}</span>
          <input type="file" accept=".pdf" hidden @change="onDocAChange">
        </label>
      </div>

      <div class="control-group">
        <label class="file-label">
          <span class="file-btn">Document B</span>
          <span class="file-name">{{ docBName }}</span>
          <input type="file" accept=".pdf" hidden @change="onDocBChange">
        </label>
      </div>

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
      <div v-if="!docAFile || !docBFile" class="viewer-placeholder">
        <p>Select two PDF documents to compare</p>
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

.control-group {
  display: flex;
  align-items: center;
  gap: 6px;
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
