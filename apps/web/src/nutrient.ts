import type NutrientViewerType from '@nutrient-sdk/viewer'

let _sdk: typeof NutrientViewerType | undefined

export async function getNutrientViewer(): Promise<typeof NutrientViewerType> {
  if (!_sdk) {
    _sdk = (await import('@nutrient-sdk/viewer')).default
  }
  return _sdk
}

export const baseUrl = `${window.location.protocol}//${window.location.host}/`
