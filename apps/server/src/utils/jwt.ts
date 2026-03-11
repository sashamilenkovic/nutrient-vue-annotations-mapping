import jwt from 'jsonwebtoken'
import crypto from 'crypto'

export function generateJWT(
  documentId: string,
  permissions: string[] = ['read-document', 'write', 'download'],
  layer?: string,
): string {
  const privateKey = process.env.DE_JWT_PRIVATE_KEY

  if (!privateKey) {
    throw new Error('DE_JWT_PRIVATE_KEY environment variable is not set')
  }

  const claims: { document_id: string; permissions: string[]; layer?: string } = {
    document_id: documentId,
    permissions,
  }

  if (layer) {
    claims.layer = layer
  }

  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h',
    jwtid: crypto.randomUUID(),
  })
}
