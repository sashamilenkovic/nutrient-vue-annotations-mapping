import { createRouter, createWebHistory } from 'vue-router'
import AnnotationMappingPage from '@/pages/AnnotationMappingPage.vue'
import TextComparisonPage from '@/pages/TextComparisonPage.vue'
import CrossPageComparisonPage from '@/pages/CrossPageComparisonPage.vue'
import AdvancedComparisonPage from '@/pages/AdvancedComparisonPage.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'annotations',
      component: AnnotationMappingPage,
    },
    {
      path: '/text-comparison',
      name: 'text-comparison',
      component: TextComparisonPage,
    },
    {
      path: '/cross-page-comparison',
      name: 'cross-page-comparison',
      component: CrossPageComparisonPage,
    },
    {
      path: '/advanced-comparison',
      name: 'advanced-comparison',
      component: AdvancedComparisonPage,
    },
  ],
})

export default router
