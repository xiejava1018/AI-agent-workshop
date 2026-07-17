# Agent System Guide

This document describes the digital employee (agent) system, multi-agent orchestration, and skill management in AI Agent Workshop.

## Overview

The platform supports:

- **Digital Employees**: Persistent AI agents with bound skills and MCP extensions
- **Multi-Agent Orchestration**: Coordinated execution across multiple agents
- **Skill System**: Reusable capabilities attachable to agents
- **MCP Extensions**: External tool servers extending agent capabilities

---

## Digital Employees

### What is a Digital Employee?

A Digital Employee (Agent) is a persistent AI agent configured with:

- **Model**: The underlying LLM (e.g., claude-sonnet-4-20250514)
- **Skills**: Bound skill instances from the skill registry
- **MCP Extensions**: External MCP servers providing additional tools
- **Scope**: Visibility and access control (global/team/user)

### Creating an Agent

```bash
POST /api/digital-employees
Content-Type: application/json

{
  "name": "Code Reviewer",
  "model": "claude-sonnet-4-20250514",
  "description": "Specialized in reviewing code changes",
  "scope": "team",
  "teamId": "team_xxx",
  "skillBindings": ["skill_id_1", "skill_id_2"],
  "mcpBindings": ["mcp_server_id_1"]
}
```

Response:

```json
{
  "id": "agent_xxx",
  "name": "Code Reviewer",
  "model": "claude-sonnet-4-20250514",
  "scope": "team",
  "createdAt": "2026-07-17T00:00:00Z"
}
```

### Listing Agents

```bash
GET /api/digital-employees
```

Response:

```json
{
  "agents": [
    {
      "id": "agent_xxx",
      "name": "Code Reviewer",
      "model": "claude-sonnet-4-20250514",
      "scope": "team",
      "createdAt": "2026-07-17T00:00:00Z"
    }
  ]
}
```

### Getting Agent Details

```bash
GET /api/digital-employees/{id}
```

### Updating an Agent

```bash
PUT /api/digital-employees/{id}
Content-Type: application/json

{
  "name": "Senior Code Reviewer",
  "skillBindings": ["skill_id_1", "skill_id_3"]
}
```

### Deleting an Agent

```bash
DELETE /api/digital-employees/{id}
```

---

## Agent Sessions

Agents run in sessions. A session represents a single conversation/execution context.

### Starting a Session

```bash
POST /api/agent/new
Content-Type: application/json

{
  "agentId": "agent_xxx",
  "cwd": "/path/to/project"
}
```

Response:

```json
{
  "sessionId": "sess_xxx",
  "agentId": "agent_xxx"
}
```

### Streaming Events (SSE)

```bash
GET /api/agent/{sessionId}/events
```

The SSE endpoint streams events:

- `message`: Text output from the agent
- `tool_update`: Tool invocation details
- `tool_result`: Tool execution result
- `prompt_done`: Execution completed successfully
- `prompt_error`: Execution failed

### Stopping a Session

```bash
DELETE /api/sessions/{sessionId}
```

---

## Multi-Agent Orchestration

Multi-agent orchestration coordinates multiple agents to complete complex tasks.

### Delegation Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `sync` | Sequential execution, waits for each agent | Tasks with dependencies |
| `parallel` | All agents execute simultaneously | Independent subtasks |
| `async` | Background execution with callbacks | Long-running tasks |

### Orchestration Flow

1. **Task Decomposition**: Break task into subtasks
2. **Agent Selection**: Choose agents for each subtask
3. **Mode Selection**: Pick delegation mode
4. **Execution**: Agents execute per mode
5. **Result Aggregation**: Combine results

### Orchestration API

```bash
POST /api/orchestration/execute
Content-Type: application/json

{
  "task": "Review the authentication module and update tests",
  "agents": [
    { "agentId": "agent_code", "task": "Review auth module" },
    { "agentId": "agent_test", "task": "Update auth tests" }
  ],
  "mode": "sync",
  "onComplete": "callback_url (optional)"
}
```

Response:

```json
{
  "orchestrationId": "orch_xxx",
  "status": "running",
  "tree": {
    "id": "orch_xxx",
    "type": "root",
    "children": [
      { "id": "step_1", "agentId": "agent_code", "status": "running" },
      { "id": "step_2", "agentId": "agent_test", "status": "pending" }
    ]
  }
}
```

### Checking Orchestration Status

```bash
GET /api/orchestration/{orchestrationId}/status
```

---

## Skill System

Skills are reusable capability units that can be bound to agents.

### Skill Scopes

| Scope | Description | Who Can Use |
|-------|-------------|-------------|
| `global` | Available to all users | Admin configured |
| `team` | Available to team members | Team admin configured |
| `user` | Available to single user | User configured |

### Listing Skills

```bash
GET /api/skills
```

Response:

```json
{
  "skills": [
    {
      "id": "skill_xxx",
      "name": "code-review",
      "description": "Performs code review",
      "scope": "global",
      "version": "1.0.0"
    }
  ]
}
```

### Installing a Skill

```bash
POST /api/skills/install
Content-Type: application/json

{
  "name": "code-review",
  "scope": "team",
  "teamId": "team_xxx"
}
```

### Searching Skills

```bash
GET /api/skills/search?q=code+review
```

---

## MCP Extensions

MCP (Model Context Protocol) extensions provide external tools to agents.

### MCP Server Management

```bash
# List MCP servers
GET /api/admin/mcp

# Configure MCP server
POST /api/admin/mcp
Content-Type: application/json

{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "env": {}
}
```

### Binding MCP to Agent

When creating/updating an agent, specify `mcpBindings`:

```json
{
  "mcpBindings": ["mcp_server_id_1", "mcp_server_id_2"]
}
```

---

## Authentication

All API endpoints require authentication.

### Login

```bash
POST /api/auth/user-login
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}
```

Response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user_xxx",
    "username": "user@example.com"
  }
}
```

### Using the Token

Include the token in subsequent requests:

```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## Audit Logging

All significant actions are logged for compliance and debugging.

```bash
GET /api/admin/audit
```

Query parameters:

- `userId`: Filter by user
- `action`: Filter by action type
- `from`: Start date
- `to`: End date
- `limit`: Max results (default 100)

Response:

```json
{
  "logs": [
    {
      "id": "log_xxx",
      "userId": "user_xxx",
      "action": "agent.create",
      "resourceType": "digital_employee",
      "resourceId": "agent_xxx",
      "metadata": {},
      "createdAt": "2026-07-17T00:00:00Z"
    }
  ]
}
```

---

## Team Management

### Creating a Team

```bash
POST /api/admin/teams
Authorization: Bearer ...
Content-Type: application/json

{
  "name": "Engineering Team",
  "tokenDailyLimit": 100000,
  "maxConcurrentSessions": 10
}
```

### Managing Team Members

```bash
# Add member
POST /api/admin/teams/{teamId}/members
{
  "userId": "user_xxx",
  "role": "MEMBER"
}

# Remove member
DELETE /api/admin/teams/{teamId}/members/{userId}

# Change role
PUT /api/admin/teams/{teamId}/members/{userId}
{
  "role": "ADMIN"
}
```

### Team Roles

| Role | Permissions |
|------|-------------|
| `OWNER` | Full control, can transfer ownership |
| `ADMIN` | Manage members, agents, skills |
| `MEMBER` | Use assigned agents and skills |
