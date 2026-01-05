# Pensieve Hooks Integration

Pensieve can integrate with Claude Code's hooks system to automatically save and restore session context during compaction and session resumption.

## Quick Setup

1. Copy the example `settings.json` to your Claude Code settings directory:

```bash
# macOS/Linux
cp hooks/settings.json ~/.claude/settings.json

# Or merge with existing settings if you have them
```

2. The hooks will automatically:
   - **PreCompact**: Save a session snapshot before context compaction
   - **SessionStart**: Load previous context when resuming a session

## CLI Commands

Pensieve provides these CLI commands for hook integration:

### `pensieve auto-save`

Saves a minimal session snapshot. Used by PreCompact hooks.

```bash
# Basic auto-save (timestamps the save automatically)
pensieve auto-save

# With custom summary
pensieve auto-save --summary "Implemented user auth"

# With work-in-progress and next steps
pensieve auto-save \
  --summary "Working on auth" \
  --wip "OAuth flow partially complete" \
  --next "Add refresh token handling"
```

### `pensieve load-context`

Outputs the last session context to stdout. Used by SessionStart hooks.

```bash
# Text format (default) - for injection into prompts
pensieve load-context

# JSON format - for programmatic use
pensieve load-context --format json
```

### `pensieve status`

Shows database location and counts.

```bash
pensieve status
```

## Hook Configuration

The hooks system uses matchers to determine when to run:

### PreCompact Hooks

Run before Claude Code compacts the conversation context:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [{ "type": "command", "command": "pensieve auto-save" }]
      },
      {
        "matcher": "manual",
        "hooks": [{ "type": "command", "command": "pensieve auto-save" }]
      }
    ]
  }
}
```

### SessionStart Hooks

Run when starting or resuming a session:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [{ "type": "command", "command": "pensieve load-context" }]
      },
      {
        "matcher": "resume",
        "hooks": [{ "type": "command", "command": "pensieve load-context" }]
      }
    ]
  }
}
```

## Environment Variables

You can control which database Pensieve uses:

- `PENSIEVE_DB_PATH` - Explicit path to the database file
- `PENSIEVE_PROJECT_DIR` - Project directory (uses `$dir/.pensieve/memory.sqlite`)

Example hook with project-specific database:

```json
{
  "type": "command",
  "command": "PENSIEVE_PROJECT_DIR=$(pwd) pensieve auto-save"
}
```

## Troubleshooting

### Check if Pensieve is working

```bash
pensieve status
```

### Test the hooks manually

```bash
# Test auto-save
pensieve auto-save --summary "Test save"

# Test load-context
pensieve load-context
```

### Database location

By default, Pensieve stores data in:
- Project-local: `./.pensieve/memory.sqlite` (if `.git` or `.pensieve` exists)
- Global fallback: `~/.claude-pensieve/memory.sqlite`
