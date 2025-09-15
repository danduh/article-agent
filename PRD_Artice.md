# Product Requirements Document: AI Article Writing Agent (TypeScript)

## Summary
An AI-powered Article Writing Agent, implemented in TypeScript, that turns short briefs, outlines, and reference links into high-quality, SEO-friendly long-form articles. The agent supports reproducible drafts, source citations, editorial revisions, and publishing/export workflows. Scope covers REST APIs, a minimal web UI for brief → outline → draft review, asynchronous generation jobs, and integrations for CMS publishing and plagiarism checks.

## Goals and Non-Goals
- **Goals**:
  - Generate 800–2,000+ word articles with headline, outline, body, SEO metadata, and image suggestions.
  - Deterministic and auditable outputs: prompt versioning, model parameters, seeds, and artifact storage.
  - Source-aware drafting with inline citations and a bibliography built from provided references.
  - Section-level regeneration with guided instructions while preserving version history.
  - Multi-tenant readiness with org-scoped data and rate limits.
  - Export to Markdown/HTML and publish to popular CMS platforms.
  - Operational visibility: structured logs, tracing, metrics; PII-safe prompt handling.
- **Non-Goals**:
  - Rich desktop publishing, advanced PDF layout, or design tooling beyond simple export.
  - Real-time multi-user co-editing in v1 (single editor locking only).
  - Hosting first-party image generation models (use external services if needed).
  - Translation/localization features.

## User Stories & Acceptance Criteria
1) Create an article from a brief
- API: `POST /api/v1/articles`
- Request: `{ title, brief, keywords[], tone, length, references[], templateId? }`
- Returns: `202 { jobId, articleId }`; job status available at `/api/v1/jobs/{jobId}`
- Validations: title 3–120 chars; brief ≥ 20 chars; keywords unique ≤ 10; references ≤ 20 HTTPS URLs; length ∈ {short,medium,long}

2) Generate and edit an outline prior to drafting
- API: `POST /api/v1/outlines:generate`
- Returns: `200 { outline }` with up to 30 sections; headings 3–80 chars
- API: `POST /api/v1/outlines/{id}/sections/{idx}:regenerate` for section-level regeneration → `200 { section }`

3) Regenerate a specific article section with guidance
- API: `POST /api/v1/articles/{id}/sections/{sectionId}:rewrite`
- Returns: `202 { jobId }`; applies as a new version upon completion
- Validations: guidance ≤ 2,000 chars; section cannot be empty

4) Ingest references for citations
- API: `POST /api/v1/references:ingest`
- Returns: `201 { sources[] }` with normalized titles/URLs; duplicates removed when `dedupe=true`
- Drafts include inline markers like `[1]` mapped to sources

5) View version history and diffs
- API: `GET /api/v1/articles/{id}/versions`
- Returns: `200 { items: [{ version, createdAt, promptHash, diffSummary }] }`

6) Enforce org-level limits and audit actions
- API: `GET /api/v1/audit-logs` (admin only)
- Returns: `200 { items, nextCursor? }`

7) Export or publish a finalized article
- API: `POST /api/v1/articles/{id}:export` → `200 { filename, contentType, url }`
- API: `POST /api/v1/articles/{id}:publish` → `202 { jobId }` and later CMS URL upon success

8) Track job progress and errors
- API: `GET /api/v1/jobs/{id}` → `200 { id, status, steps[], startedAt, completedAt, error? }` with status ∈ {queued,running,completed,failed,canceled}

## API Contracts
### Base URL: `/api/v1`
- `POST /articles` → `202 { jobId, articleId }` | `400` | `401` | `429`
Request example:
```json
{
  "title": "How to Use Vector Databases",
  "brief": "Explain concepts, use-cases, and best practices",
  "keywords": ["vector db", "embeddings", "RAG"],
  "tone": "practical",
  "length": "long",
  "references": [
    { "type": "url", "value": "https://example.com/guide" }
  ],
  "templateId": "tech-howto-v1"
}
```
Response example:
```json
{ "jobId": "job_01H...", "articleId": "art_01H..." }
```

- `GET /articles/{id}` → `200 { article }` | `404` | `401`
Article schema (abridged):
```json
{
  "id": "art_01H...",
  "orgId": "org_123",
  "title": "...",
  "outline": [{ "id": "sec_1", "heading": "Intro", "children": [] }],
  "contentHtml": "<h1>...</h1>",
  "contentMarkdown": "# ...",
  "metadata": {
    "keywords": ["..."],
    "tone": "practical",
    "length": "long",
    "seo": { "score": 87, "titleTag": "...", "metaDescription": "..." },
    "sources": [{ "index": 1, "title": "...", "url": "..." }],
    "promptHash": "sha256:...",
    "model": { "provider": "openai", "name": "gpt-4o-mini" }
  },
  "version": 5,
  "status": "ready",
  "createdAt": "...",
  "updatedAt": "..."
}
```

- `POST /outlines:generate` → `200 { outline }` | `400` | `401`
Request: `{ title, brief, keywords[], tone }`

- `POST /outlines/{id}/sections/{idx}:regenerate` → `200 { section }` | `400` | `404`

- `POST /articles/{id}/sections/{sectionId}:rewrite` → `202 { jobId }` | `400` | `404` | `409`

- `POST /references:ingest` → `201 { sources[] }` | `400` | `401`
Request example:
```json
{ "references": [{ "type": "url", "value": "https://..." }], "dedupe": true }
```

- `GET /articles/{id}/versions` → `200 { items: [{version, createdAt, author, promptHash, diffSummary}] }`

- `POST /articles/{id}:export` → `200 { filename, contentType, url }` | `404`

- `POST /articles/{id}:publish` → `202 { jobId }` | `404` | `409`

- `GET /jobs/{id}` → `200 { id, status, steps[], startedAt, completedAt, error? }` | `404`

Validation highlights:
- `tone` ∈ {practical,informative,casual,technical}; `length` ∈ {short,medium,long}
- `keywords[]` unique, ≤ 10; `references[]` total ≤ 20, HTTPS only
- `contentMarkdown` ≤ 150k chars; outline sections ≤ 200

## Technical Implementation
### Stack
- Backend: TypeScript (NestJS or Express + Zod), REST + OpenAPI, class-validator or zod for DTOs
- Worker: Node.js TypeScript with BullMQ (Redis) for async jobs
- LLM Clients: provider-agnostic interface (OpenAI, Azure OpenAI, Anthropic) with retries/backoff
- Storage: MongoDB (content/versioning), Redis (queue), optional PostgreSQL (users/orgs/audit)
- UI: React + TypeScript (Material UI), minimal editor with Markdown preview

### Architecture & Flows
- Pipeline: Brief → Outline → Research/References → Draft → SEO pass → Citations pass → Plagiarism scan (optional) → Finalize → Export/Publish
- Jobs: Idempotent keys `articleId#step#version`, at-least-once processing, DLQ and retries with jitter
- Prompt Versioning: hash over prompt text + system instructions + tool schema + model + params (temperature, top_p, seed)
- Citations: reference ingestion normalizes sources and assigns index; inline markers `[n]` mapped to metadata.sources
- Section Rewrites: apply guided rewrite, record diff summary, bump version; cap history (e.g., last 50) and archive to object storage if exceeded

### Database Schema (high-level)
- MongoDB: `articles { orgId, title, outline[], contentMarkdown, contentHtml, metadata{}, version, deleted, createdAt, updatedAt }`
- MongoDB: `jobs { id, orgId, articleId, type, status, steps[], error?, startedAt, completedAt }`
- MongoDB: `sources { orgId, url, canonicalUrl, title, textHash, excerpt, lastFetchedAt }`
- PostgreSQL (optional): `users`, `organizations`, `audit_logs`, `cms_connections`
- Indexes: `{ orgId: 1, updatedAt: -1 }`, `{ articleId: 1, version: -1 }`, text index on `contentMarkdown` (optional)

### Security & Multi-Tenancy
- JWT payload `{ sub, email, name, role, orgId }`; enforce `orgId` on every query and job
- Role-based access: admin, editor, writer; scope publish/export to editor/admin
- CORS allowlist, input validation/sanitation, SSRF-safe reference fetching via proxy/allowlist
- Secrets management for model keys and CMS tokens

### Integrations
- CMS: WordPress, Ghost via REST; store credentials per org (encrypted)
- Plagiarism: integrate vendor API via async job, store score and report URL
- SEO: simple scoring heuristic (readability, headings, keywords density) + optional external API

### Infrastructure (reference design)
- Containers for API and Worker; Redis for queue; MongoDB (managed or self-hosted)
- Object storage (S3-compatible) for artifacts and exports
- Observability: structured logs (pino or winston), OpenTelemetry traces/metrics

## Non-Functional Requirements
- **Security**: JWT verification, org scoping, RBAC, encryption at rest/in transit
- **Performance**: P95 < 300ms for non-generation APIs; outline within 10s; draft within 120s (async)
- **Reliability**: at-least-once jobs, idempotency, DLQ, health checks, autoscaling guidance
- **Compliance**: audit logs for generate/publish; configurable data retention; PII redaction in prompts
- **Observability**: trace each job step; per-org cost tracking for model usage

## Migration & Rollout
- Mongoose schema versioning; optional Postgres migrations (if used)
- Feature flags for citations, plagiarism, and publish integrations
- Phased rollout: internal → pilot → GA with conservative rate limits

## Testing Strategy
- Unit: DTO validators, outline generator, citation mapper, prompt hashing, provider adapters
- Integration: job pipeline with mocked LLM and reference fetch; Redis + Mongo interactions
- E2E: brief → outline → draft → section rewrite → export/publish (CMS mocked)
- Load/Chaos: queue saturation, retry/DLQ behavior, worker autoscaling triggers
- Security: JWT tamper tests, org boundary enforcement, SSRF and URL validation
