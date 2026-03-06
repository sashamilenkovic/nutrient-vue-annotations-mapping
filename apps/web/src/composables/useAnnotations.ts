import { type Ref } from 'vue'
import type { Instance } from '@nutrient-sdk/viewer'
import { getNutrientViewer } from '@/nutrient'

export function useAnnotations(instance: Ref<Instance | null>) {
  async function createRedaction(pageIndex: number, rect: { left: number; top: number; width: number; height: number }) {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()
    const annotation = new SDK.Annotations.RedactionAnnotation({
      pageIndex,
      rects: SDK.Immutable.List([new SDK.Geometry.Rect(rect)]),
      color: SDK.Color.RED,
      overlayText: 'REDACTED',
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function createStamp(pageIndex: number, boundingBox: { left: number; top: number; width: number; height: number }, stampType: 'text' | 'image' = 'text') {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()

    if (stampType === 'text') {
      const annotation = new SDK.Annotations.StampAnnotation({
        pageIndex,
        stampType: 'Approved',
        title: 'Approved',
        subtitle: 'Quality Check',
        color: SDK.Color.GREEN,
        boundingBox: new SDK.Geometry.Rect(boundingBox),
      })

      const created = await inst.create(annotation)
      return created[0] ?? null
    }

    const annotation = new SDK.Annotations.ImageAnnotation({
      pageIndex,
      boundingBox: new SDK.Geometry.Rect(boundingBox),
      description: 'Custom stamp image',
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function createArrow(pageIndex: number, start: { x: number; y: number }, end: { x: number; y: number }) {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()
    const annotation = new SDK.Annotations.LineAnnotation({
      pageIndex,
      startPoint: new SDK.Geometry.Point(start),
      endPoint: new SDK.Geometry.Point(end),
      lineCaps: { start: null, end: 'openArrow' },
      strokeColor: SDK.Color.BLUE,
      strokeWidth: 2,
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function createInk(pageIndex: number, lines: Array<Array<{ x: number; y: number }>>) {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()
    const inkLines = SDK.Immutable.List(
      lines.map((line) => SDK.Immutable.List(line.map((p) => new SDK.Geometry.DrawingPoint({ x: p.x, y: p.y })))),
    )

    const annotation = new SDK.Annotations.InkAnnotation({
      pageIndex,
      lines: inkLines,
      strokeColor: SDK.Color.RED,
      strokeWidth: 3,
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function createRectangle(pageIndex: number, rect: { left: number; top: number; width: number; height: number }, color?: { r: number; g: number; b: number }) {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()
    const c = color
      ? new SDK.Color({ r: color.r, g: color.g, b: color.b })
      : new SDK.Color({ r: 255, g: 235, b: 59 })

    const annotation = new SDK.Annotations.RectangleAnnotation({
      pageIndex,
      boundingBox: new SDK.Geometry.Rect(rect),
      strokeColor: c,
      fillColor: c,
      opacity: 0.3,
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function createAnnotationWithCustomData(
    pageIndex: number,
    rect: { left: number; top: number; width: number; height: number },
    customData: Record<string, unknown>,
    creatorName?: string,
  ) {
    const inst = instance.value
    if (!inst) return null

    const SDK = await getNutrientViewer()
    const annotation = new SDK.Annotations.RectangleAnnotation({
      pageIndex,
      boundingBox: new SDK.Geometry.Rect(rect),
      strokeColor: SDK.Color.BLUE,
      fillColor: new SDK.Color({ r: 200, g: 220, b: 255 }),
      opacity: 0.4,
      customData,
      creatorName: creatorName || 'DemoUser',
    })

    const created = await inst.create(annotation)
    return created[0] ?? null
  }

  async function exportInstantJSON() {
    const inst = instance.value
    if (!inst) return null

    return inst.exportInstantJSON()
  }

  return {
    createRedaction,
    createStamp,
    createArrow,
    createInk,
    createRectangle,
    createAnnotationWithCustomData,
    exportInstantJSON,
  }
}
