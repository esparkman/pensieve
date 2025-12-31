---
description: Load and display context from Pensieve at the start of a conversation. Use this at the beginning of every session to ensure continuity from previous work.
---

# /session-start

Display and confirm the context loaded from Pensieve at the start of a conversation.

## Purpose

Pensieve automatically loads context when the MCP server starts. This command:
- Displays what was loaded for transparency
- Starts session tracking for the current conversation
- Provides continuity from previous sessions

## Step 1: Start Session Tracking

Use the `pensieve_session_start` MCP tool to begin tracking this session:

```json
{}
```

This creates a new session record that will be updated when `/session-end` is called.

## Step 2: Get Full Context

Use the `pensieve_get_context` MCP tool to retrieve all loaded context:

```json
{}
```

This returns:
- Last session summary and next steps
- Key decisions
- User preferences
- Open questions
- Recent discoveries

## Step 3: Present Context

Format and present the loaded context to the user:

```
## Session Started

### Last Session
**Date:** [started_at]
**Summary:** [summary]

### Work in Progress
[work_in_progress or "None"]

### Planned Next Steps
[next_steps or "None"]

### Key Decisions
- [topic]: [decision]
- [topic]: [decision]
...

### Your Preferences
- [category]/[key]: [value]
...

### Open Questions
- [question]
...

---

Ready to continue. What would you like to work on?
```

## Fresh Installation

If Pensieve returns no prior context, inform the user:

```
## Session Started (Fresh Installation)

No prior context found. This appears to be a fresh Pensieve installation.

Your memories will be stored as you work. Use:
- `/remember` to save decisions, preferences, and discoveries
- `/recall` to query stored knowledge
- `/session-end` before ending to save your progress

What would you like to work on?
```

## Notes

- Pensieve auto-loads context when the MCP server starts, so this command primarily displays what's already loaded
- Session tracking begins with this command and ends with `/session-end`
- Context persists in `~/.pensieve/memory.sqlite` (user-level) or project-level if configured
