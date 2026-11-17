# Security Policy

## Rate Limiting

All public API endpoints implement per-IP rate limiting. Requests are approved by the native Workers `RATE_LIMITER` binding (zero KV writes); a Cloudflare KV sliding window is used only as a fallback when that binding is absent. The binding must be declared in **both** `wrangler.api.toml` and `wrangler.jsonc`, because the front worker runs the API handlers in-process for server-rendered pages. Without it in the front worker, limiting falls back to KV writes (1,000/day on the free plan).

| Endpoint | Limit | Window | Lockout |
|---|---|---|---|
| `POST /api/classify-claim` | 10 req | 60s | 120s |
| `GET /api/search` | 60 req | 60s | 120s |
| `GET /api/paper/:id` | 100 req | 60s | 120s |
| `GET /api/trending` | 100 req | 60s | 120s |
| `POST /admin/*` | 3 req | 60s | 60s |

Rate limits are enforced using a token bucket algorithm with sliding windows. On rate limit exceeded:
- HTTP 429 response with `Retry-After` header
- Lockout period triggers after exceeding limit
- KV failures fail open (don't block traffic on infrastructure issues)

## Bot and Quota Guards

The Workers Free plan allows 100,000 requests/day per account. Past that, Cloudflare answers every request itself with a `429` before any of our code runs, so abusive crawlers are an availability risk, not just a nuisance.

- **Crawler blocking**: known AI-training crawlers and SEO scrapers (matched by `User-Agent`) receive a cacheable `403` from both the front worker (`middleware.ts`) and the API worker (`src/api-worker/index.ts`) before any SSR, D1, KV or AI work. `robots.txt` also disallows them from `/`.
- **Per-IP limit (front worker)**: 40 requests/minute per IP, in isolate memory.
- **Daily breaker**: both workers return `429` + `Retry-After: 3600` past 95,000 requests/day (UTC).

Limits of these guards: user-agent matching is trivially spoofed, the counters are per isolate (not a global total), and a blocked request is still a Worker invocation that counts toward the 100,000. They protect D1, KV and AI quota and soften the failure; they are not a hard cap. Stronger options (Bot Fight Mode, WAF rate-limit rules in front of the Worker) require a custom domain on Cloudflare. The `X-Real-IP` identity header is honoured only with a matching `X-Internal-Auth` (`INTERNAL_TOKEN`), so clients cannot forge it.

## Input Validation

All user inputs are sanitized before processing:

- **SQL Injection**: All D1 queries use parameterized `.prepare().bind()` — zero injection surface
- **Control Characters**: Stripped via `sanitizeQuery()` on all text inputs
- **Length Limits**: Enforced per field type (see `src/shared/sanitize.ts`)
- **Allowlists**: Date filters, categories use strict allowlists
- **Regex Validation**: arXiv IDs, email addresses validated with strict patterns

### AI Endpoints

`POST /api/classify-claim` has additional protections:
- Hard character limits before prompt assembly (claim: 500, abstract: 2000)
- Per-IP rate limiting (10 req/min) to prevent quota exhaustion
- Output schema validation (LLM response is validated, not blindly trusted)
- Generic error messages in 500 responses (no internal detail leakage)

## Authentication

### Admin Endpoints

`/admin/*` routes require:
- `x-admin-secret` header with timing-safe comparison (`crypto.timingSafeEqual`)
- Per-IP rate limiting (3 attempts per 60s)
- Constant-time validation (no timing oracle attacks)

Admin secret is set via Wrangler:
```bash
wrangler secret put ADMIN_SECRET --config wrangler.api.toml
```

### Public Endpoints

No authentication required — zero login design. Rate limiting provides abuse protection.

## CORS

- **Strict Origin**: Only configured domain allowed (no wildcard `*`)
- **Preflight**: OPTIONS requests handled with proper headers
- **Startup Validation**: Wildcard origin throws error at worker initialization

Current allowed origin: Set via `ALLOWED_ORIGIN` in `wrangler.api.toml`

## Error Handling

- **500 Errors**: Generic messages only, internal details logged server-side
- **KV Errors**: Surface as 503 (not silent cache misses)
- **D1 Errors**: Logged with paper ID, generic message returned to client
- **AI Errors**: Specific handling for quota/rate-limit vs generic failures

## Data Protection

### Secrets

Files that may contain secrets are handled carefully:
- `.env*` files: Never committed, listed in `.gitignore`
- `wrangler.toml`: Contains public config only, secrets managed via Wrangler CLI
- Admin secret: Stored in Cloudflare Workers secrets, never in code

### User Data

- **No PII**: Project doesn't collect personal information
- **Client-Side Storage**: Bookmarks/collections in localStorage (90-day TTL)
- **No Server Logs**: User activity not logged beyond request timing

## External API Integrations

All external API calls implement timeouts and error handling:

- **arXiv API**: `AbortSignal.timeout(10000)` on fetch
- **Semantic Scholar**: Rate limit respect, retry logic
- **CrossRef**: Timeout + error handling
- **Workers AI**: Quota tracking, graceful degradation

## Security Checklist

Before deploying:

- [ ] Admin secret set in production: `wrangler secret put ADMIN_SECRET`
- [ ] `ALLOWED_ORIGIN` updated to production domain in `wrangler.api.toml`
- [ ] Rate limiting KV namespace properly bound in `wrangler.api.toml`
- [ ] `RATE_LIMITER` rate-limit binding declared in both `wrangler.api.toml` and `wrangler.jsonc`
- [ ] `INTERNAL_TOKEN` set on the front worker (and on the API worker for the fallback paths)
- [ ] All external API keys stored as secrets (not in code)
- [ ] Error logging enabled for 500 errors
- [ ] KV and D1 bindings verified in production

## Reporting Vulnerabilities

To report a security issue:
1. **Do not** open a public GitHub issue
2. Contact: [security email from your profile/site]
3. Include: description, steps to reproduce, impact assessment
4. Response time: 48 hours for acknowledgment, 7 days for initial assessment

## Security Updates

This project uses:
- Next.js 16+ (latest security patches)
- Cloudflare Workers runtime (auto-updated)
- Pinned dependencies (checked monthly via `npm audit`)

## Additional Hardening

Future considerations:
- WAF rules for common attack patterns
- Request signing for admin endpoints
- Automated security scanning in CI/CD
- Content Security Policy enforcement (already implemented in Next.js)
