#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryDatabase, LIMITS } from './database.js';
import { checkFieldsForSecrets, formatSecretWarning } from './security.js';

// Initialize database
const db = new MemoryDatabase();

// Create MCP server
const server = new Server(
  {
    name: 'pensieve',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'pensieve_remember',
        description: 'Save a decision, preference, discovery, or entity to persistent memory. Use this to record important information that should persist across conversations.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['decision', 'preference', 'discovery', 'entity', 'question'],
              description: 'The type of information to remember'
            },
            // For decisions
            topic: {
              type: 'string',
              description: 'Topic of the decision (e.g., "authentication", "styling")'
            },
            decision: {
              type: 'string',
              description: 'The decision that was made'
            },
            rationale: {
              type: 'string',
              description: 'Why this decision was made'
            },
            // For preferences
            category: {
              type: 'string',
              description: 'Category of preference (e.g., "coding_style", "testing")'
            },
            key: {
              type: 'string',
              description: 'Preference key'
            },
            value: {
              type: 'string',
              description: 'Preference value'
            },
            // For discoveries
            name: {
              type: 'string',
              description: 'Name of the discovered item'
            },
            location: {
              type: 'string',
              description: 'File path or location'
            },
            description: {
              type: 'string',
              description: 'Description of the item'
            },
            // For entities
            relationships: {
              type: 'string',
              description: 'JSON string of relationships (e.g., {"belongs_to": ["Tenant"], "has_many": ["Orders"]})'
            },
            attributes: {
              type: 'string',
              description: 'JSON string of key attributes'
            },
            // For questions
            question: {
              type: 'string',
              description: 'The question to record'
            },
            context: {
              type: 'string',
              description: 'Context for the question'
            }
          },
          required: ['type']
        }
      },
      {
        name: 'pensieve_recall',
        description: 'Query the memory database to retrieve past decisions, preferences, discoveries, or entities. Use this to understand prior context.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to find relevant memories'
            },
            type: {
              type: 'string',
              enum: ['all', 'decisions', 'preferences', 'discoveries', 'entities', 'questions', 'session'],
              description: 'Type of memories to search (default: all)'
            },
            category: {
              type: 'string',
              description: 'Filter by category (for preferences or discoveries)'
            }
          }
        }
      },
      {
        name: 'pensieve_session_start',
        description: 'Start a new session and load context from the last session. Call this at the beginning of a conversation to restore prior context.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'pensieve_session_end',
        description: 'End the current session and save a summary. Call this before ending a conversation to persist learnings.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Summary of what was accomplished this session'
            },
            work_in_progress: {
              type: 'string',
              description: 'Description of work that is still in progress'
            },
            next_steps: {
              type: 'string',
              description: 'Planned next steps for the next session'
            },
            key_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of key files that were worked on'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorizing this session'
            }
          },
          required: ['summary']
        }
      },
      {
        name: 'pensieve_resolve_question',
        description: 'Mark an open question as resolved with the resolution.',
        inputSchema: {
          type: 'object',
          properties: {
            question_id: {
              type: 'number',
              description: 'ID of the question to resolve'
            },
            resolution: {
              type: 'string',
              description: 'How the question was resolved'
            }
          },
          required: ['question_id', 'resolution']
        }
      },
      {
        name: 'pensieve_status',
        description: 'Get the current memory status including database location and counts.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'pensieve_remember': {
        const { type } = args as { type: string };

        switch (type) {
          case 'decision': {
            const { topic, decision, rationale } = args as {
              topic: string;
              decision: string;
              rationale?: string;
            };
            if (!topic || !decision) {
              return { content: [{ type: 'text', text: 'Error: topic and decision are required for decisions' }] };
            }

            // Check for secrets
            const secretCheck = checkFieldsForSecrets({ topic, decision, rationale });
            if (secretCheck.containsSecret) {
              return { content: [{ type: 'text', text: formatSecretWarning(secretCheck) }] };
            }

            const id = db.addDecision({ topic, decision, rationale, source: 'user' });
            return {
              content: [{
                type: 'text',
                text: `✓ Remembered decision #${id}:\n  Topic: ${topic}\n  Decision: ${decision}${rationale ? `\n  Rationale: ${rationale}` : ''}`
              }]
            };
          }

          case 'preference': {
            const { category, key, value } = args as {
              category: string;
              key: string;
              value: string;
            };
            if (!category || !key || !value) {
              return { content: [{ type: 'text', text: 'Error: category, key, and value are required for preferences' }] };
            }

            // Check for secrets
            const secretCheck = checkFieldsForSecrets({ category, key, value });
            if (secretCheck.containsSecret) {
              return { content: [{ type: 'text', text: formatSecretWarning(secretCheck) }] };
            }

            db.setPreference({ category, key, value });
            return {
              content: [{
                type: 'text',
                text: `✓ Remembered preference:\n  ${category}/${key} = ${value}`
              }]
            };
          }

          case 'discovery': {
            const { category, name: itemName, location, description } = args as {
              category: string;
              name: string;
              location?: string;
              description?: string;
            };
            if (!category || !itemName) {
              return { content: [{ type: 'text', text: 'Error: category and name are required for discoveries' }] };
            }

            // Check for secrets
            const secretCheck = checkFieldsForSecrets({ category, name: itemName, location, description });
            if (secretCheck.containsSecret) {
              return { content: [{ type: 'text', text: formatSecretWarning(secretCheck) }] };
            }

            const id = db.addDiscovery({ category, name: itemName, location, description });
            return {
              content: [{
                type: 'text',
                text: `✓ Remembered discovery #${id}:\n  Category: ${category}\n  Name: ${itemName}${location ? `\n  Location: ${location}` : ''}${description ? `\n  Description: ${description}` : ''}`
              }]
            };
          }

          case 'entity': {
            const { name: entityName, description, relationships, attributes, location } = args as {
              name: string;
              description?: string;
              relationships?: string;
              attributes?: string;
              location?: string;
            };
            if (!entityName) {
              return { content: [{ type: 'text', text: 'Error: name is required for entities' }] };
            }

            // Check for secrets
            const secretCheck = checkFieldsForSecrets({ name: entityName, description, relationships, attributes, location });
            if (secretCheck.containsSecret) {
              return { content: [{ type: 'text', text: formatSecretWarning(secretCheck) }] };
            }

            db.upsertEntity({ name: entityName, description, relationships, attributes, location });
            return {
              content: [{
                type: 'text',
                text: `✓ Remembered entity: ${entityName}${description ? `\n  Description: ${description}` : ''}${relationships ? `\n  Relationships: ${relationships}` : ''}`
              }]
            };
          }

          case 'question': {
            const { question, context } = args as { question: string; context?: string };
            if (!question) {
              return { content: [{ type: 'text', text: 'Error: question is required' }] };
            }

            // Check for secrets
            const secretCheck = checkFieldsForSecrets({ question, context });
            if (secretCheck.containsSecret) {
              return { content: [{ type: 'text', text: formatSecretWarning(secretCheck) }] };
            }

            const id = db.addQuestion(question, context);
            return {
              content: [{
                type: 'text',
                text: `✓ Recorded open question #${id}:\n  ${question}${context ? `\n  Context: ${context}` : ''}`
              }]
            };
          }

          default:
            return { content: [{ type: 'text', text: `Error: Unknown type "${type}"` }] };
        }
      }

      case 'pensieve_recall': {
        const { query, type = 'all', category } = args as {
          query?: string;
          type?: string;
          category?: string;
        };

        let result = '';

        if (type === 'session') {
          const session = db.getLastSession();
          if (session) {
            result = `## Last Session\n`;
            result += `Started: ${session.started_at}\n`;
            result += `Ended: ${session.ended_at || 'In progress'}\n`;
            if (session.summary) result += `\n**Summary:** ${session.summary}\n`;
            if (session.work_in_progress) result += `\n**Work in Progress:** ${session.work_in_progress}\n`;
            if (session.next_steps) result += `\n**Next Steps:** ${session.next_steps}\n`;
            if (session.key_files) result += `\n**Key Files:** ${session.key_files}\n`;
          } else {
            result = 'No previous sessions found.';
          }
        } else if (type === 'preferences') {
          const prefs = category ? db.getPreferencesByCategory(category) : db.getAllPreferences();
          if (prefs.length > 0) {
            result = `## Preferences${category ? ` (${category})` : ''}\n\n`;
            prefs.forEach(p => {
              result += `- **${p.category}/${p.key}:** ${p.value}${p.notes ? ` (${p.notes})` : ''}\n`;
            });
          } else {
            result = 'No preferences found.';
          }
        } else if (type === 'questions') {
          const questions = db.getOpenQuestions();
          if (questions.length > 0) {
            result = `## Open Questions\n\n`;
            questions.forEach(q => {
              result += `- [#${q.id}] ${q.question}${q.context ? ` (Context: ${q.context})` : ''}\n`;
            });
          } else {
            result = 'No open questions.';
          }
        } else if (type === 'entities') {
          const entities = db.getAllEntities();
          if (entities.length > 0) {
            result = `## Entities\n\n`;
            entities.forEach(e => {
              result += `### ${e.name}\n`;
              if (e.description) result += `${e.description}\n`;
              if (e.relationships) result += `Relationships: ${e.relationships}\n`;
              if (e.location) result += `Location: ${e.location}\n`;
              result += '\n';
            });
          } else {
            result = 'No entities found.';
          }
        } else if (query) {
          const searchResults = db.search(query);

          if (searchResults.decisions.length > 0) {
            result += `## Decisions matching "${query}"\n\n`;
            searchResults.decisions.forEach(d => {
              result += `- **${d.topic}:** ${d.decision}${d.rationale ? ` (${d.rationale})` : ''}\n`;
            });
            result += '\n';
          }

          if (searchResults.discoveries.length > 0) {
            result += `## Discoveries matching "${query}"\n\n`;
            searchResults.discoveries.forEach(d => {
              result += `- **${d.name}** [${d.category}]: ${d.description || 'No description'}${d.location ? ` at ${d.location}` : ''}\n`;
            });
            result += '\n';
          }

          if (searchResults.entities.length > 0) {
            result += `## Entities matching "${query}"\n\n`;
            searchResults.entities.forEach(e => {
              result += `- **${e.name}:** ${e.description || 'No description'}\n`;
            });
          }

          if (!result) {
            result = `No memories found matching "${query}"`;
          }
        } else {
          // Default: show recent decisions and preferences
          const decisions = db.getRecentDecisions(5);
          const prefs = db.getAllPreferences();

          if (decisions.length > 0) {
            result += `## Recent Decisions\n\n`;
            decisions.forEach(d => {
              result += `- **${d.topic}:** ${d.decision}\n`;
            });
            result += '\n';
          }

          if (prefs.length > 0) {
            result += `## Preferences\n\n`;
            prefs.forEach(p => {
              result += `- **${p.category}/${p.key}:** ${p.value}\n`;
            });
          }

          if (!result) {
            result = 'Memory is empty. Use memory_remember to start saving context.';
          }
        }

        return { content: [{ type: 'text', text: result }] };
      }

      case 'pensieve_session_start': {
        const lastSession = db.getLastSession();
        const currentSession = db.getCurrentSession();

        // Start new session if none is active
        let sessionId: number;
        if (!currentSession) {
          sessionId = db.startSession();
        } else {
          sessionId = currentSession.id!;
        }

        let result = `## Session Started (#${sessionId})\n\n`;

        if (lastSession && lastSession.ended_at) {
          result += `### Previous Session\n`;
          result += `- **Date:** ${lastSession.started_at}\n`;
          if (lastSession.summary) result += `- **Summary:** ${lastSession.summary}\n`;
          if (lastSession.work_in_progress) result += `- **Work in Progress:** ${lastSession.work_in_progress}\n`;
          if (lastSession.next_steps) result += `- **Next Steps:** ${lastSession.next_steps}\n`;
          result += '\n';
        }

        const decisions = db.getRecentDecisions(5);
        if (decisions.length > 0) {
          result += `### Key Decisions\n`;
          decisions.forEach(d => {
            result += `- **${d.topic}:** ${d.decision}\n`;
          });
          result += '\n';
        }

        const prefs = db.getAllPreferences();
        if (prefs.length > 0) {
          result += `### Preferences\n`;
          prefs.forEach(p => {
            result += `- **${p.category}/${p.key}:** ${p.value}\n`;
          });
          result += '\n';
        }

        const questions = db.getOpenQuestions();
        if (questions.length > 0) {
          result += `### Open Questions\n`;
          questions.forEach(q => {
            result += `- [#${q.id}] ${q.question}\n`;
          });
          result += '\n';
        }

        result += `---\nMemory database: ${db.getPath()}\n`;
        result += `Ready to continue. What would you like to work on?`;

        return { content: [{ type: 'text', text: result }] };
      }

      case 'pensieve_session_end': {
        const { summary, work_in_progress, next_steps, key_files, tags } = args as {
          summary: string;
          work_in_progress?: string;
          next_steps?: string;
          key_files?: string[];
          tags?: string[];
        };

        const currentSession = db.getCurrentSession();
        if (!currentSession) {
          return {
            content: [{
              type: 'text',
              text: 'No active session found. Starting a new one and ending it immediately.'
            }]
          };
        }

        db.endSession(currentSession.id!, summary, work_in_progress, next_steps, key_files, tags);

        let result = `## Session Saved\n\n`;
        result += `**Summary:** ${summary}\n`;
        if (work_in_progress) result += `**Work in Progress:** ${work_in_progress}\n`;
        if (next_steps) result += `**Next Steps:** ${next_steps}\n`;
        if (key_files?.length) result += `**Key Files:** ${key_files.join(', ')}\n`;
        if (tags?.length) result += `**Tags:** ${tags.join(', ')}\n`;
        result += `\n---\nSession ended. Your context has been saved for next time.`;

        return { content: [{ type: 'text', text: result }] };
      }

      case 'pensieve_resolve_question': {
        const { question_id, resolution } = args as { question_id: number; resolution: string };
        db.resolveQuestion(question_id, resolution);
        return {
          content: [{
            type: 'text',
            text: `✓ Question #${question_id} resolved: ${resolution}`
          }]
        };
      }

      case 'pensieve_status': {
        const decisions = db.getRecentDecisions(100);
        const prefs = db.getAllPreferences();
        const entities = db.getAllEntities();
        const questions = db.getOpenQuestions();
        const lastSession = db.getLastSession();

        let result = `## Memory Status\n\n`;
        result += `**Database:** ${db.getPath()}\n\n`;
        result += `**Counts:**\n`;
        result += `- Decisions: ${decisions.length}\n`;
        result += `- Preferences: ${prefs.length}\n`;
        result += `- Entities: ${entities.length}\n`;
        result += `- Open Questions: ${questions.length}\n`;
        result += `- Last Session: ${lastSession ? lastSession.started_at : 'None'}\n`;

        return { content: [{ type: 'text', text: result }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }]
        };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }
});

// Output prior context on startup
function outputPriorContext(): void {
  const lastSession = db.getLastSession();
  const decisions = db.getRecentDecisions(5);
  const prefs = db.getAllPreferences();
  const questions = db.getOpenQuestions();

  const hasContent = lastSession?.summary || decisions.length > 0 || prefs.length > 0 || questions.length > 0;

  if (!hasContent) {
    console.error('🧙 Pensieve ready (no prior context yet)');
    return;
  }

  console.error('');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('🧙 PENSIEVE — Prior Context Loaded');
  console.error('═══════════════════════════════════════════════════════════════');

  if (lastSession?.ended_at) {
    console.error('');
    console.error('📋 LAST SESSION:');
    if (lastSession.summary) console.error(`   ${lastSession.summary}`);
    if (lastSession.work_in_progress) {
      console.error('');
      console.error('🚧 WORK IN PROGRESS:');
      console.error(`   ${lastSession.work_in_progress}`);
    }
    if (lastSession.next_steps) {
      console.error('');
      console.error('➡️  NEXT STEPS:');
      console.error(`   ${lastSession.next_steps}`);
    }
  }

  if (decisions.length > 0) {
    console.error('');
    console.error('🎯 KEY DECISIONS:');
    decisions.forEach(d => {
      console.error(`   • [${d.topic}] ${d.decision}`);
    });
  }

  if (prefs.length > 0) {
    console.error('');
    console.error('⚙️  PREFERENCES:');
    prefs.forEach(p => {
      console.error(`   • ${p.category}/${p.key}: ${p.value}`);
    });
  }

  if (questions.length > 0) {
    console.error('');
    console.error('❓ OPEN QUESTIONS:');
    questions.forEach(q => {
      console.error(`   • [#${q.id}] ${q.question}`);
    });
  }

  console.error('');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error(`Database: ${db.getPath()}`);
  console.error('═══════════════════════════════════════════════════════════════');
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Output prior context so Claude sees it automatically
  outputPriorContext();
}

main().catch(console.error);
