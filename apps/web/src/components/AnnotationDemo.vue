<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  title: string
  description: string
}>()

const isOpen = ref(false)
</script>

<template>
  <div class="demo-section">
    <button class="demo-header" @click="isOpen = !isOpen">
      <span class="demo-title">{{ title }}</span>
      <span class="demo-chevron" :class="{ open: isOpen }">&#9656;</span>
    </button>
    <div v-if="isOpen" class="demo-body">
      <p class="demo-description">{{ description }}</p>
      <div class="demo-controls">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-section {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.demo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 14px;
  background: #fafafa;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  text-align: left;
}

.demo-header:hover {
  background: #f0f0f0;
}

.demo-chevron {
  transition: transform 0.15s;
  font-size: 12px;
}

.demo-chevron.open {
  transform: rotate(90deg);
}

.demo-body {
  padding: 12px 14px;
  border-top: 1px solid #e0e0e0;
}

.demo-description {
  font-size: 12px;
  color: #666;
  margin-bottom: 10px;
  line-height: 1.5;
}

.demo-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
