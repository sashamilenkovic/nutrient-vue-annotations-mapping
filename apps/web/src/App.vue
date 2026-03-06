<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="app">
    <header class="nav-header">
      <div class="nav-brand">Nutrient Annotation Mapping Demo</div>
      <nav class="nav-links">
        <RouterLink
          to="/"
          :class="{ active: route.name === 'annotations' }"
        >
          Annotation Mapping
        </RouterLink>
        <RouterLink
          to="/text-comparison"
          :class="{ active: route.name === 'text-comparison' }"
        >
          Text Comparison
        </RouterLink>
        <RouterLink
          to="/cross-page-comparison"
          :class="{ active: route.name === 'cross-page-comparison' }"
        >
          Cross-Page Comparison
        </RouterLink>
      </nav>
    </header>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.nav-header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  height: 48px;
  background: #1a1a2e;
  color: #fff;
  flex-shrink: 0;
}

.nav-brand {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}

.nav-links {
  display: flex;
  gap: 4px;
}

.nav-links a {
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.15s;
}

.nav-links a:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.nav-links a.active {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}

.main-content {
  flex: 1;
  overflow: hidden;
}
</style>
