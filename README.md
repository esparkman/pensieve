# Memory MCP

A persistent memory MCP server for Claude Code that remembers decisions, preferences, and context across conversation boundaries.

## Problem

When Claude Code conversations are compacted or cleared:
- Agent "forgets" discovered patterns, decisions, and understanding
- User re-explains the same context repeatedly
- Agent may hallucinate or contradict previous decisions
- Momentum lost every few hours of deep work

## Solution

Memory MCP provides persistent storage via SQLite that Claude can access through native tool calls:
- `memory_remember` — Save decisions, preferences, discoveries, entities
- `memory_recall` — Query the knowledge base
- `memory_session_start` — Load context at conversation start
- `memory_session_end` — Persist learnings before ending

## Installation

### Option 1: From local path

```bash
claude mcp add memory node ~/Development/memory-mcp/dist/index.js
```

### Option 2: Via npx (once published)

```bash
claude mcp add memory npx @evansparkman/memory-mcp
```

## Usage

After installing, Claude Code will have access to these tools:

### Start a session

At the beginning of each conversation, Claude should call:

```
memory_session_start()
```

This loads the last session's summary, work in progress, key decisions, and preferences.

### Remember things

```
memory_remember({
  type: "decision",
  topic: "authentication",
  decision: "Use Devise with magic links",
  rationale: "Passwordless is more secure and user-friendly"
})

memory_remember({
  type: "preference",
  category: "testing",
  key: "approach",
  value: "system tests for UI flows"
})

memory_remember({
  type: "entity",
  name: "Customer",
  description: "End user who places orders",
  relationships: '{"belongs_to": ["Tenant"], "has_many": ["Orders"]}'
})

memory_remember({
  type: "discovery",
  category: "component",
  name: "ButtonComponent",
  location: "app/components/base/button_component.rb",
  description: "Primary button component with variants"
})
```

### Recall things

```
memory_recall({ query: "authentication" })
memory_recall({ type: "preferences" })
memory_recall({ type: "entities" })
memory_recall({ type: "session" })
memory_recall({ type: "questions" })
```

### End a session

Before ending a conversation:

```
memory_session_end({
  summary: "Completed invoice list component with filtering",
  work_in_progress: "Invoice detail view partially designed",
  next_steps: "Complete detail view, add PDF export",
  key_files: ["app/components/invoices/invoice_list_component.rb"],
  tags: ["invoices", "ui"]
})
```

## Database Location

Memory MCP stores data in SQLite:

- **Project-local** (if `.git` or `.memory` exists): `.memory/memory.sqlite`
- **Global** (fallback): `~/.claude-memory/memory.sqlite`

This means each project gets its own memory, but you also have a global memory for general preferences.

## Tools Reference

| Tool | Purpose |
|------|---------|
| `memory_remember` | Save decisions, preferences, discoveries, entities, or questions |
| `memory_recall` | Query the knowledge base |
| `memory_session_start` | Start a session and load prior context |
| `memory_session_end` | End a session and save a summary |
| `memory_resolve_question` | Mark an open question as resolved |
| `memory_status` | Get database location and counts |

## Data Types

### Decisions
Important choices with rationale. Searchable by topic.

### Preferences
User conventions (coding style, testing approach, naming patterns).

### Discoveries
Things found in the codebase (components, patterns, helpers).

### Entities
Domain model understanding (models, relationships, attributes).

### Sessions
Summaries of work sessions for continuity.

### Open Questions
Unresolved blockers or questions to address.

## Development

```bash
cd ~/Development/memory-mcp
npm install
npm run dev    # Run with tsx for development
npm run build  # Build TypeScript
```

## License

MIT
