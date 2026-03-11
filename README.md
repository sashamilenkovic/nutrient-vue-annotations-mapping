# Nutrient Text Comparison & Movement Detection Prototype

Vue 3 demo app showcasing Nutrient Web SDK annotation types, text comparison, and cross-page document comparison.

## Architecture

Monorepo with two apps:

- **`apps/web/`** — Vue 3 + Vite frontend (port 5173)
- **`apps/server/`** — h3 API server for JWT auth + document management (port 3001)

### Four Pages

| Page | Mode | Description |
|------|------|-------------|
| `/` (Ticket Q&A) | Document Engine | Annotation demos — redaction, stamps, arrows, ink, rectangles, custom data, page rotation. Requires Document Engine running via Docker. |
| `/text-comparison` | Standalone | Headless text extraction + custom LCS diff with `wordLevel` toggle. No server needed — runs entirely in the browser. |
| `/cross-page-comparison` | Standalone | Headless text extraction + LCS diff algorithm. No server needed. |
| `/advanced-comparison` | Standalone | Line-level diff with move detection and page-aware highlighting. No server needed. |

## Prerequisites

- Node.js >= 20
- pnpm
- Docker (for Document Engine)
- A Nutrient activation key (license key) — contact your Nutrient representative if you don't have one

## Important: Nightly SDK builds

This prototype uses **nightly builds** of `@nutrient-sdk/viewer` (`"nightly"` tag in `package.json`). This is because DOCX support (used by the comparison pages) is not yet available in a stable release — it will ship in **Web SDK 1.14.0** (end of March 2026). Until then, `pnpm install` will always pull the latest nightly.

We normally recommend loading the SDK via CDN (see [CDN guide](https://www.nutrient.io/guides/web/open-a-document/from-cdn/)), but nightly builds are not published to the CDN — only stable releases are. Because of this, the SDK is installed locally as a devDependency and Vite serves the WASM/worker assets from `node_modules`. Once 1.14.0 ships, you can switch to the CDN approach if preferred.

To update to the latest nightly at any time:

```bash
pnpm --filter @annotations-demo/web add @nutrient-sdk/viewer@nightly -D
```

Once 1.14.0 is released, you can pin to the stable version and optionally switch to CDN delivery.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Generate JWT keys for Document Engine authentication:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Open `.env` and fill in these values:

| Variable | Value |
|----------|-------|
| `DE_ACTIVATION_KEY` | Your Nutrient license/activation key (required) |
| `DE_JWT_PRIVATE_KEY` | Contents of `private.pem` (see below) |
| `DE_JWT_PUBLIC_KEY` | Contents of `public.pem` (see below) |
| `VITE_LICENSE_KEY` | Your Nutrient Web SDK license key |

**Pasting multi-line JWT keys:** Wrap them in double quotes with literal `\n` for newlines:

```
DE_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----"
DE_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBI...\n-----END PUBLIC KEY-----"
```

Or use this one-liner to format a .pem file for `.env`:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem
```

### 3. Start Document Engine

```bash
docker compose up -d
```

Wait a few seconds for it to become healthy, then verify:

```bash
docker compose ps   # both containers should show "healthy"
```

### 4. Start dev servers

```bash
pnpm dev
```

Open **http://localhost:5173** — you should see the app.

### Ports

| Port | Service |
|------|---------|
| **5173** | Vue dev server (frontend) |
| **3001** | h3 API server (JWT auth, document upload) |
| **5050** | Document Engine (proxied from container port 5000) |
| **5433** | PostgreSQL (proxied from container port 5432 — uses 5433 to avoid conflicts with a local Postgres) |

### Document Engine Dashboard

Available at **http://localhost:5050/dashboard** for inspecting documents and annotations directly.

- Username: `dashboard` (or `DE_DASHBOARD_USERNAME` in `.env`)
- Password: `secret` (or `DE_DASHBOARD_PASSWORD` in `.env`)

### Adding Documents

Place PDF/DOCX files in `apps/web/public/documents/` for easy access, or upload via the Ticket Q&A page sidebar.

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
| `apps/web/src/pages/TextComparisonPage.vue` | Headless extraction + LCS diff UI |
| `apps/web/src/pages/CrossPageComparisonPage.vue` | Headless extraction + LCS diff |
| `apps/server/src/routes/jwt.ts` | JWT generation endpoint |
| `apps/server/src/routes/documents.ts` | Document upload/list/delete |
