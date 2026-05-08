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
    isLoading.value = true
    error.value = null
    currentDocumentId.value = documentId

    try {
      const SDK = await getNutrientViewer()

      // Defensively detach anything previously mounted on this container.
      // Covers (a) re-uploading a different document into the same container,
      // and (b) hot-reload / state-reset cases where `instance.value` is null
      // but the SDK is still attached to the DOM. Without this, `SDK.load`
      // throws "container already there" on the second mount.
      try {
        SDK.unload(container)
      } catch {
        // Nothing was attached.
      }
      instance.value = null

      const jwt = await fetchJWT(documentId)

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

  // Best-effort unload. Callers without a container handle (route changes,
  // teardown) get the ref cleared; callers with a container should pass it
  // so the SDK actually detaches from the DOM.
  async function unload(container?: HTMLElement) {
    if (container) {
      try {
        const SDK = await getNutrientViewer()
        SDK.unload(container)
      } catch {
        // Nothing was attached.
      }
    }
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
