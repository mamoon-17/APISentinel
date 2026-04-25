# Spec Pack For Repo-Specific Analysis

Use one spec per repository in APISentinel.

## Files

- auth-service.openapi.yaml
  - Best for repos with endpoints like /register, /login, /logout, /refresh, /me, /guest
- codemap.openapi.yaml
  - Tailored for CodeMap-style endpoint set found by scanner
- user-service.openapi.yaml
  - Best for repos with endpoints like /users and /users/{id}
- processing-service.openapi.yaml
  - Best for repos with endpoints like /upload, /analyze-snippet, /ingest, and generic root processing routes
- spendsense.openapi.yaml
  - Tailored for SpendSense-style endpoint set found by scanner

## Suggested Mapping

- CodeMap repo -> codemap.openapi.yaml
- SpendSense repo -> spendsense.openapi.yaml
- Auth-focused repos -> auth-service.openapi.yaml
- User CRUD repos -> user-service.openapi.yaml
- Ingestion/analysis repos -> processing-service.openapi.yaml

## Note

If a repo still shows many "Not in spec" endpoints, open that repo's Endpoint Usage list and add any missing endpoints into that repo's specific OpenAPI file.
