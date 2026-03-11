import { createRouter, eventHandler, readMultipartFormData, createError, getRouterParam } from 'h3'

const DE_URL = () => process.env.DE_URL || 'http://localhost:5050'
const DE_TOKEN = () => process.env.DE_API_AUTH_TOKEN || 'secret'

function authHeaders() {
  return { Authorization: `Token token=${DE_TOKEN()}` }
}

export const documentRoutes = createRouter()

// List all documents
documentRoutes.get(
  '/api/documents',
  eventHandler(async () => {
    const res = await fetch(`${DE_URL()}/api/documents`, {
      headers: authHeaders(),
    })

    if (!res.ok) {
      throw createError({ statusCode: res.status, message: 'Failed to list documents' })
    }

    return res.json()
  }),
)

// Upload a document (PDF or Office)
documentRoutes.post(
  '/api/documents',
  eventHandler(async (event) => {
    const parts = await readMultipartFormData(event)
    const filePart = parts?.find((p) => p.name === 'file')

    if (!filePart || !filePart.data) {
      throw createError({ statusCode: 400, message: 'No file provided' })
    }

    const filename = filePart.filename || 'document'
    const ext = filename.split('.').pop()?.toLowerCase()

    const contentTypeMap: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }

    const contentType = contentTypeMap[ext || ''] || 'application/pdf'

    const res = await fetch(`${DE_URL()}/api/documents`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: new Uint8Array(filePart.data),
    })

    if (!res.ok) {
      const text = await res.text()
      throw createError({
        statusCode: res.status,
        message: `Upload failed: ${text}`,
      })
    }

    const data = (await res.json()) as { data?: { document_id?: string } }
    return {
      documentId: data.data?.document_id,
      originalFilename: filename,
      message: 'Document uploaded successfully',
    }
  }),
)

// Delete a document
documentRoutes.delete(
  '/api/documents/:id',
  eventHandler(async (event) => {
    const id = getRouterParam(event, 'id')

    const res = await fetch(`${DE_URL()}/api/documents/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })

    if (!res.ok) {
      throw createError({ statusCode: res.status, message: 'Failed to delete document' })
    }

    return { message: 'Document deleted' }
  }),
)
