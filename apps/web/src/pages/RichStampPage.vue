<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Instance } from '@nutrient-sdk/viewer'
import type NutrientViewer from '@nutrient-sdk/viewer'
import { getNutrientViewer } from '@/nutrient'
import DocumentViewer from '@/components/DocumentViewer.vue'

const route = useRoute()
const router = useRouter()

const instance = ref<Instance | null>(null)
const SDK = ref<typeof NutrientViewer | null>(null)
const documentId = ref<string>((route.query.documentId as string) || '')

watch(documentId, (id) => {
  const query = id ? { documentId: id } : {}
  router.replace({ query })
})

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
    }
  } catch (err) {
    console.error('Upload failed:', err)
  }
}

function clearDocument() {
  documentId.value = ''
  instance.value = null
  SDK.value = null
}

async function onViewerLoaded(inst: Instance) {
  instance.value = inst
  SDK.value = await getNutrientViewer()
}

async function checkmarkPng(): Promise<File> {
  const resp = await fetch('/images/checkmark.png')
  const blob = await resp.blob()
  return new File([blob], 'checkmark.png', { type: 'image/png' })
}

async function addSignedOff() {
  const inst = instance.value
  const sdk = SDK.value
  if (!inst || !sdk) return

  await inst.create(new sdk.Annotations.StampAnnotation({
    pageIndex: 0,
    stampType: 'Custom',
    title: `SIGNED OFF\nCompliance Team\n${new Date().toISOString().slice(0, 10)}`,
    boundingBox: new sdk.Geometry.Rect({ left: 50, top: 50, width: 300, height: 80 }),
    multiline: true,
    font: 'Helvetica',
    fontSize: 14,
    fontColor: new sdk.Color({ r: 0, g: 100, b: 0 }),
    isBold: true,
    isItalic: false,
    color: new sdk.Color({ r: 0, g: 100, b: 0 }),
  }))
}

async function addDoNotDistribute() {
  const inst = instance.value
  const sdk = SDK.value
  if (!inst || !sdk) return

  await inst.create(new sdk.Annotations.StampAnnotation({
    pageIndex: 0,
    stampType: 'Custom',
    title: 'DO NOT DISTRIBUTE\nInternal Eyes Only',
    boundingBox: new sdk.Geometry.Rect({ left: 50, top: 160, width: 300, height: 60 }),
    multiline: true,
    font: 'Courier',
    fontSize: 13,
    fontColor: new sdk.Color({ r: 180, g: 0, b: 0 }),
    isBold: true,
    isItalic: true,
    color: new sdk.Color({ r: 180, g: 0, b: 0 }),
  }))
}

async function addProcessedByNutrient() {
  const inst = instance.value
  const sdk = SDK.value
  if (!inst || !sdk) return

  const file = await checkmarkPng()
  const imageAttachmentId = await inst.createAttachment(file)

  await inst.create(new sdk.Annotations.StampAnnotation({
    pageIndex: 0,
    stampType: 'Custom',
    title: 'PROCESSED\nNutrient Document Engine\nAutomated Pipeline',
    boundingBox: new sdk.Geometry.Rect({ left: 50, top: 250, width: 340, height: 80 }),
    multiline: true,
    font: 'Helvetica',
    fontSize: 12,
    fontColor: new sdk.Color({ r: 26, g: 35, b: 126 }),
    isBold: true,
    isItalic: false,
    color: new sdk.Color({ r: 222, g: 214, b: 196 }),
    imageAttachmentId,
    imageContentType: 'image/png',
  }))
}

async function addAllStamps() {
  await addSignedOff()
  await addDoNotDistribute()
  await addProcessedByNutrient()
}
</script>

<template>
  <div class="page-layout">
    <aside class="sidebar">
      <h2 class="sidebar-title">Rich Stamp Annotations</h2>
      <p class="sidebar-description">
        Multiline text with custom fonts and embedded images — all rendered by Core into a single appearance stream.
      </p>

      <label class="upload-btn">
        Upload Document (PDF/DOCX)
        <input type="file" accept=".pdf,.docx,.xlsx,.pptx" hidden @change="uploadDocument">
      </label>

      <button v-if="documentId" class="action-btn clear-btn" @click="clearDocument">
        Clear Document
      </button>

      <template v-if="instance">
        <div class="stamp-actions">
          <button class="action-btn primary" @click="addAllStamps">
            Add All Stamps
          </button>

          <div class="divider" />

          <button class="action-btn" @click="addSignedOff">
            Signed Off (Helvetica Bold)
          </button>
          <button class="action-btn" @click="addDoNotDistribute">
            Do Not Distribute (Courier)
          </button>
          <button class="action-btn" @click="addProcessedByNutrient">
            Processed + Checkmark Image
          </button>
        </div>

        <div class="info-box">
          <strong>API Properties</strong>
          <ul>
            <li><code>multiline: true</code></li>
            <li><code>font</code>, <code>fontSize</code>, <code>fontColor</code></li>
            <li><code>isBold</code>, <code>isItalic</code></li>
            <li><code>imageAttachmentId</code>, <code>imageContentType</code></li>
          </ul>
        </div>
      </template>

    </aside>

    <div class="viewer-area">
      <div v-if="!documentId" class="viewer-placeholder">
        <p>Upload a document to get started</p>
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
  width: 280px;
  flex-shrink: 0;
  padding: 20px;
  background: #fafafa;
  border-right: 1px solid #e0e0e0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
}

.sidebar-description {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
}

.upload-btn {
  display: block;
  padding: 10px 14px;
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

.clear-btn {
  color: #d32f2f;
  border-color: #ef9a9a;
}

.clear-btn:hover {
  background: #ffebee;
  border-color: #d32f2f;
}

.stamp-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
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

.divider {
  height: 1px;
  background: #e0e0e0;
  margin: 4px 0;
}

.info-box {
  background: #f0f4ff;
  border: 1px solid #d0d8f0;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
}

.info-box strong {
  display: block;
  margin-bottom: 6px;
  color: #333;
}

.info-box ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-box code {
  background: #e8eef8;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.viewer-area {
  flex: 1;
  min-width: 0;
}

.viewer-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}
</style>
