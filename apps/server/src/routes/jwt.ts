import { createRouter, eventHandler, readBody, createError } from 'h3'
import { generateJWT } from '../utils/jwt'

export const jwtRoutes = createRouter()

jwtRoutes.post(
  '/api/jwt',
  eventHandler(async (event) => {
    try {
      const body = await readBody(event)

      if (!body?.documentId || typeof body.documentId !== 'string') {
        throw createError({
          statusCode: 400,
          message: 'documentId is required and must be a string',
        })
      }

      const token = generateJWT(body.documentId, body.permissions, body.layer)
      return { jwt: token }
    } catch (error) {
      if (error instanceof Error && error.message.includes('DE_JWT_PRIVATE_KEY')) {
        throw createError({
          statusCode: 500,
          message: 'Server not configured: JWT private key missing. See README for setup.',
        })
      }
      throw error
    }
  }),
)
