import { ref } from 'vue'
import type { Instance } from '@nutrient-sdk/viewer'
import type NutrientViewer from '@nutrient-sdk/viewer'
import { getNutrientViewer, baseUrl, licenseKey } from '@/nutrient'

export function useNutrientViewer(
  options: {
    serverUrl?: string
    theme?: 'LIGHT' | 'DARK'
    jwtEndpoint?: string
    beforeLoad?: (SDK: typeof NutrientViewer) => void
  } = {},
) {
  const instance = ref<Instance | null>(null)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)
  const currentDocumentId = ref<string | null>(null)

  const { serverUrl: rawServerUrl, theme = 'LIGHT', jwtEndpoint = '/api/jwt' } = options

  const deUrl = rawServerUrl || import.meta.env.VITE_DE_URL || 'http://localhost:5050'
  const serverUrl = deUrl.endsWith('/') ? deUrl : `${deUrl}/`

  async function fetchJWT(documentId: string): Promise<string> {
    const response = await fetch(jwtEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `Failed to fetch JWT: ${response.status}`)
    }

    const data = await response.json()
    return data.jwt
  }

  async function load(container: HTMLElement, documentId: string) {
    if (instance.value) {
      await unload()
    }

    isLoading.value = true
    error.value = null
    currentDocumentId.value = documentId

    try {
      const jwt = await fetchJWT(documentId)
      const SDK = await getNutrientViewer()

      if (options.beforeLoad) {
        options.beforeLoad(SDK)
      }

      instance.value = await SDK.load({
        container,
        serverUrl,
        baseUrl,
        licenseKey,
        theme: SDK.Theme[theme],
        documentId,
        authPayload: { jwt },
        instant: true,
      })
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      throw error.value
    } finally {
      isLoading.value = false
    }
  }

  async function unload() {
    instance.value = null
  }

  return {
    instance,
    isLoading,
    error,
    currentDocumentId,
    load,
    unload,
  }
}
