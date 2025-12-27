# Pensieve

A persistent memory MCP server for Claude Code that remembers decisions, preferences, and context across conversation boundaries.

> *"I use the Pensieve. One simply siphons the excess thoughts from one's mind, pours them into the basin, and examines them at one's leisure."* — Albus Dumbledore

## Problem

When Claude Code conversations are compacted or cleared:
- Agent "forgets" discovered patterns, decisions, and understanding
- User re-explains the same context repeatedly
- Agent may hallucinate or contradict previous decisions
- Momentum lost every few hours of deep work

## Solution

Pensieve provides persistent storage via SQLite that Claude can access through native tool calls:
- `pensieve_remember` — Save decisions, preferences, discoveries, entities
- `pensieve_recall` — Query the knowledge base
- `pensieve_session_start` — Load context at conversation start
- `pensieve_session_end` — Persist learnings before ending

## Installation

```bash
claude mcp add pensieve node ~/Development/pensieve/dist/index.js
```

## Usage

After installing, Claude Code will have access to these tools:

### Start a session

At the beginning of each conversation, Claude should call:

```
pensieve_session_start()
```

This loads the last session's summary, work in progress, key decisions, and preferences.

### Remember things

```
pensieve_remember({
  type: "decision",
  topic: "authentication",
  decision: "Use Devise with magic links",
  rationale: "Passwordless is more secure and user-friendly"
})

pensieve_remember({
  type: "preference",
  category: "testing",
  key: "approach",
  value: "system tests for UI flows"
})

pensieve_remember({
  type: "entity",
  name: "Customer",
  description: "End user who places orders",
  relationships: '{"belongs_to": ["Tenant"], "has_many": ["Orders"]}'
})

pensieve_remember({
  type: "discovery",
  category: "component",
  name: "ButtonComponent",
  location: "app/components/base/button_component.rb",
  description: "Primary button component with variants"
})
```

### Recall things

```
pensieve_recall({ query: "authentication" })
pensieve_recall({ type: "preferences" })
pensieve_recall({ type: "entities" })
pensieve_recall({ type: "session" })
pensieve_recall({ type: "questions" })
```

### End a session

Before ending a conversation:

```
pensieve_session_end({
  summary: "Completed invoice list component with filtering",
  work_in_progress: "Invoice detail view partially designed",
  next_steps: "Complete detail view, add PDF export",
  key_files: ["app/components/invoices/invoice_list_component.rb"],
  tags: ["invoices", "ui"]
})
```

## Database Location

Pensieve stores data in SQLite:

- **Project-local** (if `.git` or `.pensieve` exists): `.pensieve/memory.sqlite`
- **Global** (fallback): `~/.claude-pensieve/memory.sqlite`

This means each project gets its own memory, but you also have a global memory for general preferences.

## Tools Reference

| Tool | Purpose |
|------|---------|
| `pensieve_remember` | Save decisions, preferences, discoveries, entities, or questions |
| `pensieve_recall` | Query the knowledge base |
| `pensieve_session_start` | Start a session and load prior context |
| `pensieve_session_end` | End a session and save a summary |
| `pensieve_resolve_question` | Mark an open question as resolved |
| `pensieve_status` | Get database location and counts |

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
cd ~/Development/pensieve
npm install
npm run dev    # Run with tsx for development
npm run build  # Build TypeScript
```

## License

MIT
