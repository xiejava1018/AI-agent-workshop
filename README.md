# AI Agent Workshop

A multi-agent AI agent workshop platform with Vue3 frontend and Next.js backend, supporting digital employees, multi-agent orchestration, skill management, and MCP extensions.

## Tech Stack

- **Frontend**: Vue 3 + Pinia + Element Plus + vue-pure-admin (`apps/dashboard`)
- **Backend**: Next.js 16 Route Handlers + Prisma + PostgreSQL (`apps/web`)
- **Agent Runtime**: Pi Agent 0.80.6 (`@earendil-works/pi-coding-agent`)
- **Database**: PostgreSQL with Prisma ORM
- **Security**: AES-256-GCM encryption, tenant isolation, CSRF protection

## M3: Vue3 Workbench + Digital Employees + Multi-Agent Orchestration

### Feature Overview

- **Vue3 Unified Workbench** (`apps/dashboard`): Workspace, Digital Employees, Agent Workbench, Multi-Agent Orchestration, Skill Center
- **Digital Employees (Agents)**: Create and manage AI agents, bind skills and MCP extensions
- **Multi-Agent Orchestration**: Support sync/parallel/async delegation modes with visual orchestration tree
- **Skill System**: Global/team/user三层作用域，按 Agent 绑定
- **MCP Extensions**: Manage extended tools via MCP Server
- **Security**: AES-256-GCM encryption, tenant isolation, CSRF protection

### Quick Start

```bash
# Install dependencies
pnpm install

# Setup database (PostgreSQL required)
# Set DATABASE_URL in apps/web/.env.local
# Example: postgresql://user:pass@localhost:5432/ai_agent_workshop

# Run migrations
cd apps/web && pnpm prisma migrate dev

# Start backend
cd apps/web && pnpm dev

# Start frontend (new terminal)
cd apps/dashboard && pnpm dev

# Open http://localhost:5173 to access Vue3 workbench
```

### Project Structure

```
apps/
├── dashboard/          # Vue3 frontend (workbench UI)
│   └── src/
│       ├── views/     # Page components
│       │   ├── agent-workbench/    # Agent conversation interface
│       │   ├── digital-employees/  # Agent creation & management
│       │   ├── orchestration/      # Multi-agent orchestration
│       │   ├── skill-center/       # Skill management
│       │   └── workspace/          # Workspace management
│       ├── api/       # Frontend API client
│       ├── composables/ # Vue composables
│       └── store/     # Pinia stores
│
└── web/              # Next.js backend
    └── app/api/
        ├── auth/                 # Authentication endpoints
        ├── digital-employees/    # Agent CRUD
        ├── skills/              # Skill management
        ├── plugins/             # MCP extensions
        ├── admin/
        │   ├── teams/           # Team management
        │   ├── users/           # User management
        │   ├── audit/           # Audit logs
        │   ├── mcp/             # MCP server management
        │   └── models/          # Model configuration
        ├── sessions/            # Agent sessions
        └── agent/               # Agent runtime events (SSE)
```

### Digital Employees

Create and manage AI agents in the "Digital Employees" page:

- Choose agent model and configuration
- Bind skills and MCP extensions
- Set permission scope (global/team/user)

Agents can be invoked in the "Agent Workbench" for conversations.

### Multi-Agent Orchestration

In the "Orchestration" page:

1. Enter task description
2. Select agents to use
3. Choose execution mode:
   - **Sync**: Sequential execution, one agent at a time
   - **Parallel**: Multiple agents execute simultaneously
   - **Async**: Background execution with notifications

The orchestration tree displays execution progress in real-time.

### Skill System

Skills support three scopes:

| Scope | Visibility | Binding |
|-------|------------|---------|
| Global | All teams | Admin configured |
| Team | Team members only | Team admin configured |
| User | Single user | User configured |

### API Reference

All API endpoints require authentication. Use `/api/auth/user-login` to obtain credentials.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/user-login` | User login |
| POST | `/api/auth/user-register` | User registration |
| GET | `/api/digital-employees` | List digital employees |
| POST | `/api/digital-employees` | Create digital employee |
| GET | `/api/digital-employees/[id]` | Get digital employee details |
| PUT | `/api/digital-employees/[id]` | Update digital employee |
| DELETE | `/api/digital-employees/[id]` | Delete digital employee |
| GET | `/api/skills` | List skills |
| POST | `/api/skills/install` | Install skill |
| GET | `/api/admin/teams` | List teams |
| POST | `/api/admin/teams` | Create team |
| GET | `/api/admin/audit` | Audit logs |
| GET | `/api/admin/mcp` | List MCP servers |
| POST | `/api/admin/mcp` | Configure MCP server |

### Security

- **Encryption**: Sensitive data encrypted with AES-256-GCM
- **Tenant Isolation**: Data access scoped to team membership
- **CSRF Protection**: All state-changing endpoints protected
- **Audit Logging**: All actions logged with user attribution

## Development

### Running Tests

```bash
# Backend tests
cd apps/web && pnpm test

# Single test file
cd apps/web && npx vitest run <path>
```

### Database

```bash
# Generate Prisma client
cd apps/web && pnpm prisma generate

# Run migrations
cd apps/web && pnpm prisma migrate dev

# Apply migrations in production
cd apps/web && pnpm prisma migrate deploy
```

### Environment Variables

Create `apps/web/.env.local`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_agent_workshop
SESSION_SECRET=your-session-secret-min-32-chars
```

## License

MIT
