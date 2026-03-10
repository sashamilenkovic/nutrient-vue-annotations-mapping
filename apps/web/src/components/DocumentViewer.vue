<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type NutrientViewer from '@nutrient-sdk/viewer'
import { useNutrientViewer } from '@/composables/useNutrientViewer'

const props = defineProps<{
  documentId: string
  beforeLoad?: (SDK: typeof NutrientViewer) => void
}>()

const emit = defineEmits<{
  loaded: [instance: NonNullable<ReturnType<typeof useNutrientViewer>['instance']['value']>]
}>()

const containerEl = ref<HTMLElement | null>(null)
const { instance, isLoading, error, load } = useNutrientViewer({
  beforeLoad: props.beforeLoad,
})

async function loadDocument(docId: string) {
  if (!containerEl.value) return
  await load(containerEl.value, docId)
  if (instance.value) {
    emit('loaded', instance.value)
  }
}

onMounted(() => {
  loadDocument(props.documentId)
})

watch(() => props.documentId, (newId, oldId) => {
  if (newId !== oldId) {
    loadDocument(newId)
  }
})
</script>

<template>
  <div class="viewer-wrapper">
    <div v-if="isLoading" class="viewer-overlay">Loading document...</div>
    <div v-if="error" class="viewer-overlay error">{{ error.message }}</div>
    <div ref="containerEl" class="viewer-container" />
  </div>
</template>

<style scoped>
.viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewer-container {
  width: 100%;
  height: 100%;
}

.viewer-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  color: #666;
  z-index: 10;
}

.viewer-overlay.error {
  color: #d32f2f;
}
</style>
