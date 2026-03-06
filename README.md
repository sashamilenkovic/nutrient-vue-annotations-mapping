# Nutrient Vue Annotation Mapping Demo

Vue 3 demo app showcasing Nutrient Web SDK annotation types, text comparison, and cross-page document comparison.

## Architecture

Monorepo with two apps:

- **`apps/web/`** — Vue 3 + Vite frontend (port 5173)
- **`apps/server/`** — h3 API server for JWT auth + document management (port 3001)

### Three Pages

| Page | Mode | Description |
|------|------|-------------|
| `/` | Document Engine | Annotation mapping demos — redaction, stamps, arrows, ink, rectangles, custom data, toolbar limiting |
| `/text-comparison` | Standalone | Built-in `loadTextComparison()` with `wordLevel` toggle |
| `/cross-page-comparison` | Standalone | Headless text extraction + LCS diff algorithm |

## Prerequisites

- Node.js >= 20
- pnpm
- Docker (for Document Engine)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment config
cp .env.example .env
# Edit .env with your JWT keys and activation key (see below)

# 3. Start Document Engine
docker compose up -d

# 4. Start dev servers (web + API)
pnpm dev
```

Open http://localhost:5173

### JWT Key Generation

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Paste the key contents into `.env` as `DE_JWT_PRIVATE_KEY` and `DE_JWT_PUBLIC_KEY`.

### Adding Documents

Place PDF/DOCX files in `apps/web/public/documents/` for easy access, or upload via the Annotation Mapping page sidebar.

## Development

```bash
pnpm dev          # Start both web + server
pnpm dev:web      # Web only (port 5173)
pnpm dev:server   # Server only (port 3001)
pnpm type-check   # TypeScript check across all packages
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/nutrient.ts` | Module-level NutrientViewer re-export |
| `apps/web/src/composables/useNutrientViewer.ts` | DE mode viewer lifecycle |
| `apps/web/src/composables/useAnnotations.ts` | Annotation CRUD helpers |
| `apps/web/src/pages/AnnotationMappingPage.vue` | 7 annotation demo sections |
| `apps/web/src/pages/TextComparisonPage.vue` | Built-in comparison UI |
| `apps/web/src/pages/CrossPageComparisonPage.vue` | Headless extraction + LCS diff |
| `apps/server/src/routes/jwt.ts` | JWT generation endpoint |
| `apps/server/src/routes/documents.ts` | Document upload/list/delete |
# nutrient-vue-annotations-mapping
