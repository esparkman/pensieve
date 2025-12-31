---
description: Persist learnings and summarize the session before ending. Use this before closing a conversation to save decisions, discoveries, and next steps for continuity.
---

# /session-end

Persist learnings and summarize the session before context is cleared.

## Purpose

Save everything learned during this session so the next conversation can pick up seamlessly:
- Summarize accomplishments
- Note work in progress
- Record planned next steps
- Persist any unrecorded decisions or preferences

## Step 1: Gather Session Information

Ask the user (or infer from conversation):
- What was accomplished this session?
- What is still in progress?
- What are the planned next steps?

If the user doesn't provide this, attempt to summarize based on the conversation.

## Step 2: Identify Key Files

List the key files that were worked on during this session:

```bash
# If git is available, check recent changes
git diff --name-only HEAD~1 2>/dev/null || echo "Unable to detect changed files"
```

Or track files mentioned during the conversation.

## Step 3: Save Any Pending Memories

Before ending the session, use `pensieve_remember` to save any decisions, discoveries, or preferences that were made but not yet recorded.

For each unrecorded decision:
```json
{
  "type": "decision",
  "topic": "[topic]",
  "content": "[decision]",
  "rationale": "[rationale]"
}
```

For each unrecorded discovery:
```json
{
  "type": "discovery",
  "category": "[category]",
  "name": "[name]",
  "location": "[location]",
  "description": "[description]"
}
```

## Step 4: End Session with Summary

Use the `pensieve_session_end` MCP tool to finalize the session:

```json
{
  "summary": "[what was accomplished]",
  "work_in_progress": "[what's still ongoing]",
  "next_steps": "[planned actions for next session]",
  "key_files": ["file1.rb", "file2.ts"]
}
```

## Step 5: Confirm Session Saved

Present a summary to the user:

```
## Session Saved

### Summary
[what was accomplished]

### Work in Progress
[what's still ongoing]

### Next Steps
[planned actions for next session]

### Key Files
- [file1]
- [file2]

### Decisions Recorded
- [decision1]
- [decision2]

### Open Questions
- [question1]

---

Your session has been saved. When you start a new conversation,
Pensieve will automatically load this context.
```

## Automatic Triggers

Consider running `/session-end` when:
- User says "goodbye", "done", "that's all", etc.
- User explicitly requests to save progress
- A significant milestone is completed

## Example

**User:** "Okay, I think we're done for now. We finished the user authentication flow."

**Action:** Call `pensieve_session_end` with:
```json
{
  "summary": "Completed user authentication flow with Devise, including login, logout, password reset, and magic link support",
  "work_in_progress": "Email templates (partially styled)",
  "next_steps": "1. Complete email templates\n2. Add OAuth providers\n3. Add two-factor authentication",
  "key_files": [
    "app/models/user.rb",
    "app/controllers/sessions_controller.rb",
    "config/initializers/devise.rb"
  ]
}
```

**Output:**
```
## Session Saved

### Summary
Completed user authentication flow with Devise, including:
- Login/logout functionality
- Password reset flow
- Magic link support

### Work in Progress
Email templates (partially styled)

### Next Steps
1. Complete email templates
2. Add OAuth providers
3. Add two-factor authentication

### Key Files
- app/models/user.rb
- app/controllers/sessions_controller.rb
- config/initializers/devise.rb

### Decisions Recorded
- Use Devise with magic links for passwordless auth

---

Your session has been saved. See you next time!
```
