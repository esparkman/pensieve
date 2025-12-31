---
description: Query the Pensieve knowledge base for stored information. Use to retrieve decisions, preferences, entities, discoveries, or session history.
---

# /recall

Query the Pensieve knowledge base for specific information.

## Usage

```
/recall authentication         -> Returns all auth-related memories
/recall entities               -> Returns domain model understanding
/recall session:last           -> Returns last session summary
/recall preferences:testing    -> Returns testing preferences
/recall discoveries            -> Returns all discoveries
/recall patterns               -> Returns identified patterns
/recall questions              -> Returns open questions
```

## Step 1: Parse Query

Identify what the user wants to recall:
- Topic keyword -> Search all memories for that topic
- `entities` -> List all entities
- `session:last` -> Get last session
- `preferences:[category]` -> Get preferences in category
- `discoveries` -> List all discoveries
- `patterns` -> List identified patterns
- `questions` -> List open questions

## Step 2: Use Pensieve MCP Tool

Use the `pensieve_recall` MCP tool with the appropriate query.

### Topic Search (Default)

```json
{
  "query": "[topic_keyword]"
}
```

### Entities

```json
{
  "query": "entities"
}
```

### Last Session

```json
{
  "query": "session:last"
}
```

### Preferences by Category

```json
{
  "query": "preferences:[category]"
}
```

### Discoveries

```json
{
  "query": "discoveries"
}
```

### Patterns

```json
{
  "query": "patterns"
}
```

### Open Questions

```json
{
  "query": "questions"
}
```

## Step 3: Format Results

Present the results to the user in a clear format:

```
## Recall: [query]

Found [N] results:

### Decisions
- [Topic]: [Decision] (recorded [date])

### Discoveries
- [Name]: [Description] at [location]

### Preferences
- [category]/[key]: [value]

### Entities
- [Name]: [Description] -> [Relationships]
```

If no results found:
"No memories found for '[query]'. Try a different search term or use `/remember` to save new knowledge."

## Examples

**Input:** `/recall authentication`

**Action:** Call `pensieve_recall` with:
```json
{
  "query": "authentication"
}
```

**Output:**
```
## Recall: authentication

Found 3 results:

### Decisions
- Authentication: We use Devise with magic links (recorded 2024-01-15)
- Session Management: Use Redis for session storage (recorded 2024-01-14)

### Discoveries
- DeviseConfig: Custom Devise configuration at config/initializers/devise.rb
```

**Input:** `/recall preferences:testing`

**Action:** Call `pensieve_recall` with:
```json
{
  "query": "preferences:testing"
}
```

**Output:**
```
## Recall: preferences:testing

### Preferences
- testing/approach: system tests for UI flows
- testing/coverage: 80% minimum
- testing/framework: RSpec with Capybara
```

**Input:** `/recall session:last`

**Action:** Call `pensieve_recall` with:
```json
{
  "query": "session:last"
}
```

**Output:**
```
## Recall: Last Session

**Date:** 2024-01-15 14:30
**Summary:** Implemented user authentication with Devise

### Work in Progress
Email templates (partially styled)

### Next Steps
1. Complete email templates
2. Add OAuth providers
```
