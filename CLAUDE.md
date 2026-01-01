# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pensieve is a persistent memory MCP (Model Context Protocol) server for Claude Code. It stores decisions, preferences, discoveries, entities, and session summaries in SQLite, allowing context to persist across conversation boundaries.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript to dist/
npm run dev          # Run with tsx for development (hot reload)
npm run test         # Run tests once with vitest
npm run test:watch   # Run tests in watch mode
npm start            # Run built dist/index.js
```

## Architecture

The codebase is minimal (4 source files):

- **src/index.ts** - MCP server entry point using `@modelcontextprotocol/sdk`. Defines 6 tools: `pensieve_remember`, `pensieve_recall`, `pensieve_session_start`, `pensieve_session_end`, `pensieve_resolve_question`, `pensieve_status`. Outputs prior context to stderr on startup.

- **src/database.ts** - SQLite wrapper using `better-sqlite3`. Manages 6 tables: decisions, preferences, discoveries, entities, sessions, open_questions. Implements auto-pruning (older entries removed when limits exceeded) and field truncation (max 10KB per field).

- **src/security.ts** - Secret detection. Scans for API keys, connection strings, tokens, private keys, etc. Blocks storage of detected secrets.

- **.claude/commands/** - Slash commands for session-start, session-end, remember, recall.

## Database Location

Pensieve determines database location in this order:
1. `PENSIEVE_DB_PATH` env var (explicit path)
2. `PENSIEVE_PROJECT_DIR` env var (uses `$dir/.pensieve/memory.sqlite`)
3. `.pensieve/memory.sqlite` in cwd (if `.git` or `.pensieve` exists)
4. `~/.claude-pensieve/memory.sqlite` (global fallback)

## Testing

Tests use vitest and create temporary directories in system tmpdir. Each test creates an isolated MemoryDatabase instance. Tests cover field truncation, storage limits, path resolution, and secret detection.

## MCP Integration

The server communicates over stdio using MCP protocol. It's registered with Claude Code via:
```bash
claude mcp add pensieve npx @esparkman/pensieve
```

## Key Implementation Details

- All database write operations call `ensureWritable()` which auto-reconnects if the connection becomes read-only
- Fields exceeding 10KB are truncated with `... [truncated]` suffix
- Decisions auto-prune to 1000 entries, discoveries to 500
- Sessions older than 90 days are auto-deleted
- Secret patterns include AWS keys, GitHub tokens, Stripe keys, database URLs, bearer tokens, private keys, credit cards, SSNs
