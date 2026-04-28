# API Sentinel Backend Work Breakdown

## Frontend-Driven Understanding (What backend must support)

The frontend indicates this product flow:

- User authentication (email/password plus GitHub and Google OAuth placeholders)
- Repository linking and management (GitHub/GitLab/Bitbucket URLs)
- OpenAPI spec upload, versioning, linking to repos, and deletion of spec versions
- Repo health check execution (manual and setting-driven auto-run)
- Comparison engine outputs:
  - endpoint usage found in repository/runtime traffic
  - in-spec vs out-of-spec endpoint usage
  - inconsistency categories (missing endpoint, extra endpoint, method mismatch, schema mismatch)
  - schema violations with expected vs received payload diffs
- Dashboard and repository metrics:
  - total requests, valid contracts, violation counts, uptime
  - endpoint coverage (called vs unused)
  - API calls per endpoint and per health-check cycle
- Request log feed with status, latency, response code, and violations
- Notifications and user settings persistence

## Total Backend Work Needed

### 1) Identity and tenant-safe access

- User accounts, secure sessions/JWT, role model (at minimum owner/member)
- OAuth integrations (GitHub and Google)
- Route guards and per-user access control for repositories/specs/scan results

### 2) Repository and provider integration

- Repository CRUD and provider metadata
- Provider connector abstraction for GitHub/GitLab/Bitbucket
- Secure token storage and permissions validation

### 3) OpenAPI spec management

- Upload/parse YAML and JSON
- Versioning model with active/inactive lifecycle
- Link/unlink specs to repositories
- Safe deletion rules for spec versions

### 4) Comparison and analysis engine

- Code/API usage extraction from repository source
- OpenAPI endpoint normalization and matching
- Inconsistency detection rules
- Schema validation and violation diff generation

### 5) Health checks, jobs, and execution lifecycle

- On-demand health check API
- Background worker queue for scan jobs
- Job status tracking and retry strategy
- Auto health-check on spec link (user setting driven)

### 6) Metrics, logs, and observability

- Request logs ingestion and querying
- Dashboard aggregate metrics
- Coverage and endpoint usage reporting
- Performance monitoring data model (including API calls per render cycle requirement)

### 7) Notifications and user preferences

- Notification event model and unread/read lifecycle
- Notification delivery for completed scans and high-severity violations
- Persisted user settings (notify on complete, auto-check on link)

### 8) Platform readiness

- DB schema migrations and indexing
- API error model standardization
- Integration tests for critical workflows
- Basic production hardening (rate limiting, audit logs, health endpoints)

## Team Split

## Memon - Identity, Repository Integration, and Health Check Execution

Primary goal: Own foundational access control, repository linking lifecycle, and health-check execution orchestration.

- Workstream 1: Identity and tenant-safe access
  - user registration/login and secure session/JWT handling
  - OAuth integrations (GitHub + Google)
  - ownership-aware authorization middleware for repository/spec/scan routes
  - enforce tenant boundaries in all repository and spec queries
- Workstream 2: Repository and provider integration
  - repository CRUD and provider metadata lifecycle
  - explicit ownership of repository linking/unlinking flows and lifecycle rules
  - enforce repository link preconditions (provider auth scope, repo access, duplicate-link prevention)
  - manage relink/change-link flows when a repository switches linked spec
  - provider connector abstraction for GitHub/GitLab/Bitbucket
  - secure credential/token storage with encryption at rest
  - provider permission checks and repository URL normalization
- Workstream 5: Health checks, jobs, and execution lifecycle
  - queue and worker orchestration for scan jobs
  - idempotent execution, retries, dead-letter handling, and timeouts
  - manual and automatic health-check triggers (setting-aware)
  - scan status tracking and progress reporting
- APIs to implement
  - POST /auth/signup
  - POST /auth/login
  - POST /auth/logout
  - GET /auth/me
  - GET /auth/oauth/github/callback
  - GET /auth/oauth/google/callback
  - POST /repositories
  - GET /repositories
  - GET /repositories/:id
  - PATCH /repositories/:id
  - DELETE /repositories/:id
  - POST /repositories/:id/spec-link
  - DELETE /repositories/:id/spec-link
  - POST /repositories/:id/health-checks
  - GET /repositories/:id/health-checks/latest
  - GET /health-checks/:jobId/status
- Subtasks
  - extend user module and add auth/session entities, ports, and adapters
  - add DTO validation and provider URL parser utilities
  - implement repository linking policy checks and conflict/error mapping
  - add job queue contracts and worker execution instrumentation
  - add migrations for users, oauth_accounts, sessions, repositories, repository_credentials
  - add integration tests for auth, repository ownership, linking lifecycle, and health-check execution
- Done criteria
  - login flows, repository linking, and health-check execution are fully backed by persistent APIs
  - unauthorized cross-tenant access attempts are blocked and tested

## Irti - Metrics, Notifications, and Platform Readiness

Primary goal: Own reporting, notifications, and production readiness.

- Workstream 6: Metrics, logs, and observability
  - request log ingestion/query APIs with filters and pagination
  - dashboard aggregates (total requests, valid contracts, violations, uptime)
  - endpoint usage, coverage reporting, and latency slices
  - performance model for API calls per render cycle
- Workstream 7: Notifications and user preferences
  - notification event model (scan complete, violation found, scan failed)
  - unread/read/clear lifecycle APIs
  - persisted user settings for notifyOnComplete and autoHealthCheckOnLink
- Workstream 8: Platform readiness
  - migration/index review for scan-heavy query paths
  - standardized error envelope and API reliability conventions
  - health/readiness endpoints and structured logging with correlation IDs
  - rate limiting and audit logging for sensitive routes
- APIs to implement
  - GET /dashboard/stats
  - GET /request-logs
  - GET /repositories/:id/usage-summary
  - GET /specs/:id/coverage
  - GET /notifications
  - PATCH /notifications/:id/read
  - POST /notifications/clear
  - GET /me/settings
  - PATCH /me/settings
  - GET /health
  - GET /ready
- Subtasks
  - add worker deployment profile and job observability dashboards
  - add aggregate-query caching for dashboard endpoints
  - add contract tests to match frontend payload expectations
  - add resilience tests for queue retries and partial failures
- Done criteria
  - dashboard, request logs, notifications, and settings are API-backed
  - production readiness checks pass for logging, rate limiting, and health probes

## Hymon - Spec Management and Comparison Engine

Primary goal: Own OpenAPI lifecycle and repo-vs-spec analysis logic.

- Workstream 3: OpenAPI spec management
  - upload and parse OpenAPI YAML/JSON
  - versioning model and active/inactive lifecycle controls
  - safe deletion policy for spec versions in use
- Workstream 4: Comparison and analysis engine
  - extract API usage from repository source snapshots
  - normalize endpoints and methods for matching
  - detect missing_endpoint, extra_endpoint, method_mismatch, schema_mismatch
  - produce schema diff blocks (expected vs received) with severities
- APIs to implement
  - POST /specs/upload
  - GET /specs
  - GET /specs/:id/versions
  - DELETE /specs/versions/:versionId
  - GET /repositories/:id/inconsistencies
  - GET /specs/:id/violations
- Subtasks
  - define spec parser interfaces and normalization contracts
  - implement operation matcher and inconsistency classifier
  - add fixtures based on frontend mock scenarios for deterministic tests
  - add integration tests for upload->link->analyze and version-delete safety
- Done criteria
  - spec upload/version/link/delete is persistent and safe
  - inconsistencies and schema violations endpoints return frontend-ready payloads

## Cross-Team Coordination Rules

- Common conventions (all 3):
  - Keep current clean architecture layering
  - Use shared error envelope and response typing
  - Add tests with every feature (unit + integration where applicable)
- Joint milestones:
  - Milestone 1: auth + repositories + specs CRUD complete
  - Milestone 2: scan pipeline and health-check job system complete
  - Milestone 3: dashboard/notifications/settings fully wired and stable
- Integration sync points:
  - API contract review twice weekly
  - shared seed dataset so frontend QA can validate flows quickly

## Suggested Delivery Sequence

1. Memon completes identity, repository linking, and health-check execution.
2. Hymon completes spec lifecycle and comparison engine.
3. Irti completes metrics, notifications, and platform hardening.
