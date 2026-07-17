# AI-agent-workshop

[中文文档](./README.zh-CN.md)

A multi-tenant AI coding-agent workshop built on top of the
[pi coding agent](https://github.com/badlogic/pi-mono) SDK.

AI-agent-workshop started as a fork of `xiejava1018/pi-web` v0.7.11 (itself
descended from `@agegr/pi-web`) and evolved into a **multi-user, team-scoped
web workbench** for that same agent runtime:

- a browser UI for session browsing, real-time chat, model configuration,
  plugin/skill management, and project file preview;
- a thin authentication, team and access-control layer in front of
  in-process `AgentSession` instances driven by the pi SDK.

The UI is intentionally close to upstream pi-web so people familiar with
`@agegr/pi-web` can switch over without retraining; the server side now adds
auth, projects, sessions visibility, audit logging, and the admin console.

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example file and fill in the required values:

```bash
cp .env.example .env
```

`.env` must define at least:

```text
DATABASE_URL=file:./data/dev.db        # or any Prisma-supported URL
PI_WEB_DATA_DIR=./data                 # project metadata + session files
PI_WEB_JWT_SECRET=<long random secret> # MUST be set; the server refuses to start without it
```

`PI_WEB_JWT_SECRET` is required: the server throws on boot if it is missing,
so a missing secret can never silently allow forged tokens.

### 3. Initialize database and bootstrap the root owner

The dev/start scripts already run `prisma migrate deploy` (start) or
`prisma generate` (dev) and the `scripts/bootstrap-root.ts` bootstrap, so a
plain `pnpm dev` is enough to bring the database up. On first boot:

- a `root` user is created with a random ≥16-byte URL-safe password;
- the password is printed **once** to stdout as
  `[BOOTSTRAP] root username=root password=<secret>`;
- `root` is forced to change that password on first login.

If the database already has users, the script only logs a one-line
`[BOOTSTRAP]` confirmation and does not regenerate the password.

### 4. Run

```bash
pnpm dev      # dev server, http://localhost:30141
pnpm build    # production build (do not run during normal dev — pollutes .next/)
pnpm start    # production server (after pnpm build)
```

Open <http://localhost:30141>. The login form lives at
`/{locale}/login` (default locale is English; `zh` is the other supported
locale).

### Optional: Docker

```text
docker build -t ai-agent-workshop .
docker run --rm -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -e DATABASE_URL=file:/app/data/dev.db \
  -e PI_WEB_DATA_DIR=/app/data \
  -e PI_WEB_JWT_SECRET=<long random secret> \
  ai-agent-workshop
```

The `Dockerfile` runs `prisma migrate deploy` before `pnpm build`, so a
fresh container picks up the schema automatically.

## Features

### Agent workbench (carried over from pi-web)

- **Pick work back up**: browse previous pi conversations by project without
  digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or
  fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new
  sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source,
  docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and
  system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model
  tests, plugin/skill switches from the web UI.

### Multi-user, multi-tenant additions (M2)

- **Username + password sign-in with forced rotation**: first-time
  password change is enforced server-side; all write APIs except
  `change-password` return 403 until the new password is set.
- **Two-token auth**: short-lived access token (`pw_at`, 15 min) +
  long-lived refresh token (`pw_rt`, 7 days) in HttpOnly cookies with a
  Prisma-backed revocation list. Refresh rotation issues both tokens and
  records the old refresh `jti`.
- **Team and role model**: each user belongs to one or more teams with
  `OWNER | ADMIN | MEMBER` roles. Root is bootstrapped into a default team.
- **Projects and session isolation**: `Project` rows bind a team to a
  filesystem root. `app/api/agent/new` derives `cwd` from the user's
  `lastProjectId` instead of an arbitrary body field; every file API goes
  through `lib/path-safety.ts` to block traversal/symlink escapes.
- **Session visibility filter**: `GET /api/sessions` returns the union of
  the user's own sessions, the sessions their team admins can see, and any
  sessions explicitly shared with them.
- **Per-user session cap**: maximum 5 concurrent sessions per user
  (`lib/session-cap.ts`); a global 50-session fallback protects against
  runaway clients. Exceeding the limit returns 503.
- **Admin console**: an OWNER/ADMIN dashboard can create new users
  (`POST /api/admin/users`); the server returns a one-time initial
  password that the new user must change on first login.
- **Audit log**: `lib/audit-log.ts` records security-relevant events
  (session create, cross-team access denial, session share/unshare, admin
  role change) into the `AuditLog` table with a stable `action` token and
  JSON `metadata`.
- **i18n routing**: `/{locale}/login`, `/{locale}/change-password`,
  `/{locale}/dashboard`, and `/{locale}/` (chat). Currently
  `en` and `zh`; messages live in `messages/{en,zh}.json`.

## Architecture at a Glance

```
Browser
  │
  ▼
Next.js App Router (Node.js runtime)
  │
  ├── middleware.ts ── JWT verify, must-change-password flag, x-user-id header
  │
  ├── app/[locale]/{login,change-password,dashboard}  (RSC + client forms)
  ├── app/[locale]/page.tsx     ── AppShell (chat UI, "Edit from here", fork)
  │
  ├── app/api/auth/*            ── user-login, user-logout, refresh, change-password
  ├── app/api/admin/users       ── admin user creation (OWNER/ADMIN)
  ├── app/api/projects[/...]    ── list / bind last project
  ├── app/api/agent/[id]/*      ── run / post / events; agents session in-process
  ├── app/api/agent/new         ── cwd from user.lastProjectId, per-user cap
  ├── app/api/sessions          ── 3-way union filter (self / team-admin / shared)
  ├── app/api/files             ── file listing, read, preview, watch (path-safety gated)
  ├── app/api/models, models-config, skills, plugins, worktrees, ...
  │
  ├── Prisma (SQLite by default) ── User, Team, TeamMember, Project,
  │                                RefreshTokenBlacklist, SessionShare, AuditLog
  │
  └── @earendil-works/{pi-ai, pi-coding-agent}  ── AgentSession, models.json, skills
                                                  .jsonl sessions under PI_WEB_DATA_DIR
```

Constraints worth knowing up front:

- Agent sessions still run **in-process** inside the Next.js Node process.
  Suitable for small teams (≈10 concurrent users), not for high concurrency.
- The pi SDK versions are pinned (no `^`) so `pi-coding-agent` upgrades
  cannot silently change `.jsonl` formats out from under us.

## Project Structure

```text
app/
  [locale]/                      # i18n segment (en/zh); routes exempt from middleware JWT gate
    login/page.tsx               # username + password sign-in
    change-password/page.tsx     # forced password rotation
    dashboard/page.tsx           # team / projects / create-user form (admin)
    page.tsx                     # mounts AppShell (chat UI under locale)
    layout.tsx, intl-provider.tsx
  api/
    agent/[id]/                  # POST /events /share (in-process AgentSession)
    agent/new                    # cwd from user.lastProjectId + per-user cap
    agent/running/events
    admin/users                  # OWNER/ADMIN: list / create users
    auth/{user-login,user-logout,refresh,change-password,...}
    projects/, projects/[id]     # list / bind last project
    sessions/, files/, file-index/, models/, models-config/
    skills/, plugins/, worktrees/, cwd/, default-cwd/, home/
  layout.tsx, page.tsx, globals.css, theme-init.tsx
components/
  AppShell.tsx, SessionSidebar.tsx, ChatWindow.tsx, ChatInput.tsx,
  MessageView.tsx, BranchNavigator.tsx, ChatMinimap.tsx, TabBar.tsx,
  MarkdownBody.tsx, FileExplorer.tsx, FileViewer.tsx, FileIcons.tsx,
  ModelsConfig.tsx, PluginsConfig.tsx, SkillsConfig.tsx,
  sidebar/SidebarProjectPicker.tsx
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts, useDragDrop.ts, useIsMobile.ts, useTheme.ts
lib/
  prisma.ts                              # Prisma singleton
  auth-provider.ts / -local.ts / -bootstrap.ts
  server-user.ts                         # getCurrentUserContext helper
  path-safety.ts                         # assertWithinRoot (traversal/symlink guards)
  team-auth.ts, audit-log.ts             # role checks; audit event recorder
  token-blacklist.ts                     # refresh token revocation (Prisma-backed)
  session-cap.ts                         # per-user 5 / global 50 caps
  session-reader.ts / session-meta.ts / session-file-references.ts
  rpc-manager.ts                         # AgentSessionWrapper lifecycle + registry
  markdown.ts, pi-types.ts, normalize.ts
  must-change-password.ts                # write-API gate helper
  user-role.ts, client-fetch.ts, worktree.ts, file-access.ts,
  file-paths.ts, file-links.ts, file-types.ts, file-fuzzy.ts,
  message-display.ts, markdown-config.ts, compaction-summary.ts,
  draft-store.ts, tool-presets.ts, patch.ts, ansi.ts, npx.ts, i18n.ts, types.ts
messages/
  en.json, zh.json                       # i18n strings (next-intl via lib/i18n.ts)
prisma/
  schema.prisma                          # User, Team, TeamMember, Project,
                                         # SessionShare, RefreshTokenBlacklist, AuditLog
  migrations/                            # includes M2 audit-log migration
scripts/
  bootstrap-root.ts                      # creates root owner + default team + default project
tests/
  e2e/                                   # Playwright (login flow, mustChange, cap, etc.)
  unit/                                  # vitest unit specs
openspec/
  specs/                                 # normative specs per capability
  changes/archive/                       # archived M1 / M2.2 / M2.3 implementations
docs/
  plans/                                 # design notes (multi-tenant, mini chat UI, …)
  worktrees.md, worktrees.zh-CN.md
  release.md
bin/                                     # upstream pi-web CLI shim (fork dependency)
```

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `DATABASE_URL` | yes | Prisma URL. `file:./data/dev.db` for SQLite; switch to Postgres in prod. |
| `PI_WEB_DATA_DIR` | yes | Root for project metadata and `.jsonl` sessions. Mount `./data` here. |
| `PI_WEB_JWT_SECRET` | yes | HS256 secret for `pw_at` and `pw_rt`. Server refuses to start without it. |
| `PI_WEB_MASTER_KEY` | optional | Reserved for at-rest encryption of provider API keys (future use). |
| `PI_CODING_AGENT_DIR` | optional | Override the upstream pi agent data dir (only relevant when consuming pi directly). |

## NPM Scripts

```bash
pnpm dev            # prisma generate + bootstrap-root + next dev
pnpm build          # prisma generate + next build (do not run during normal dev)
pnpm start          # bootstrap-root + next start
pnpm lint           # eslint .
pnpm test           # vitest run (unit + meta tests)
pnpm test:watch     # vitest --watch
pnpm test:e2e       # playwright test
pnpm db:migrate     # prisma migrate dev
pnpm db:generate    # prisma generate
pnpm db:reset       # prisma migrate reset --force
pnpm release        # npm version patch + pnpm build + npm publish
```

## Data Persistence

`./data` is the runtime data root. The Dockerfile bind-mounts
`-v $(pwd)/data:/app/data`. Inside it:

- `data/dev.db` is the Prisma database (SQLite by default).
- `data/projects/<project-name>/` holds project files bound to `Project.rootPath`.
- `.jsonl` session files live under this tree (path layout matches the
  upstream pi agent; managed by `@earendil-works/pi-coding-agent`).

## Development Notes

- Avoid running `pnpm build` / `next build` during normal dev — it writes
  to `.next/` and interferes with the dev server.
- pi SDK packages (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`)
  are pinned to exact versions in `package.json`. Bumping them is an
  intentional decision; check `.jsonl` compatibility first.
- The middleware uses `runtime: "nodejs"` so it can read `prisma.user` and
  forward `x-must-change-password` to write handlers.

## Testing

- **Unit (vitest)**: covers path-safety, auth-provider, session-cap,
  session-meta, audit-log, team-auth, token-blacklist, RPC manager,
  compaction-summary, message-display, file-links/types, prisma, i18n,
  must-change-password, server-user, plus meta-tests that assert every
  write API route references `enforceNotMustChange`.
- **E2E (Playwright)**: `tests/e2e/login.spec.ts` covers login UI →
  change-password → dashboard, mustChangePassword 403, sessions 3-way
  filter, and the session-cap boundaries (50 global, 5 per user).

Run with `pnpm test` and `pnpm test:e2e`.

## Roadmap

This project is being built incrementally. Archived milestones
(under `openspec/changes/archive/`) include:

- `2026-07-13-pi-web-generalized-m1-runnable` — bootstrap, JWT auth,
  projects, path-safety, session visibility filter, Docker wiring.
- `2026-07-13-pi-web-m2-2-ui-and-hardening` — `[locale]` routes, login
  UI, change-password UI, dashboard, must-change-password enforcement,
  50-session cap, Dockerfile `migrate deploy`.
- `2026-07-14-pi-web-m2-3-admin-user-management` — refresh-token +
  blacklist cookies, admin user creation, per-user session cap (5).

Design notes for upcoming work live under `docs/plans/`:

- `2026-07-14-pi-web-min-chat-ui-design.md` — minimal chat UI refinements.
- `pi-web-multi-tenant-ai-minisoc-design.md` — long-form multi-tenant
  and embedding design.
- `2026-07-12-pi-web-generalized-design.md` — earlier generalization
  sketch.

The normative capabilities (e.g. `multi-tenant-team-model`,
`agent-session-in-process`, `session-cap`, `audit-log`) live under
`openspec/specs/`.

## License

MIT (see `LICENSE`). Upstream components retain their original
licenses; see `xiejava1018/pi-web` and the
[pi coding agent](https://github.com/badlogic/pi-mono) project for
attribution.
