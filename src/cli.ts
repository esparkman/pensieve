#!/usr/bin/env node

import { Command } from 'commander';
import { MemoryDatabase } from './database.js';

// Check if we should run in MCP server mode (no CLI arguments)
// This maintains backward compatibility with existing MCP registrations
const args = process.argv.slice(2);
if (args.length === 0) {
  // No arguments - run MCP server
  import('./index.js');
} else {
  // Arguments provided - run CLI
  runCLI();
}

async function runCLI() {
  const program = new Command();

  program
    .name('pensieve')
    .description('Persistent memory CLI for Claude Code')
    .version('0.4.0');

  program
    .command('auto-save')
    .description('Save a minimal session snapshot (for PreCompact hooks)')
    .option('-s, --summary <text>', 'Session summary')
    .option('-w, --wip <text>', 'Work in progress description')
    .option('-n, --next <text>', 'Next steps')
    .action(async (options) => {
      try {
        const db = await MemoryDatabase.create();

        // Get or create current session
        const session = db.getCurrentSession();
        let sessionId: number;

        if (!session) {
          sessionId = db.startSession();
        } else {
          sessionId = session.id!;
        }

        // Build summary - use provided or generate auto-save message
        const timestamp = new Date().toISOString();
        const summary = options.summary || `Auto-save before compaction at ${timestamp}`;
        const wip = options.wip || undefined;
        const nextSteps = options.next || undefined;

        // End the session with the summary
        db.endSession(sessionId, summary, wip, nextSteps);

        // Output confirmation to stderr (stdout reserved for data)
        console.error(`[Pensieve] Session saved: ${summary}`);

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(`[Pensieve] Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('load-context')
    .description('Output last session context to stdout (for SessionStart hooks)')
    .option('-f, --format <type>', 'Output format: text or json', 'text')
    .action(async (options) => {
      try {
        const db = await MemoryDatabase.create();

        const lastSession = db.getLastSession();
        const decisions = db.getRecentDecisions(10);
        const prefs = db.getAllPreferences();
        const questions = db.getOpenQuestions();

        if (options.format === 'json') {
          const context = {
            lastSession: lastSession ? {
              started_at: lastSession.started_at,
              ended_at: lastSession.ended_at,
              summary: lastSession.summary,
              work_in_progress: lastSession.work_in_progress,
              next_steps: lastSession.next_steps,
              key_files: lastSession.key_files,
            } : null,
            decisions: decisions.map(d => ({
              topic: d.topic,
              decision: d.decision,
              rationale: d.rationale,
            })),
            preferences: prefs.map(p => ({
              category: p.category,
              key: p.key,
              value: p.value,
            })),
            openQuestions: questions.map(q => ({
              id: q.id,
              question: q.question,
              context: q.context,
            })),
          };
          console.log(JSON.stringify(context, null, 2));
        } else {
          // Text format for hook injection
          let output = '';

          if (lastSession?.ended_at) {
            output += '## Previous Session Context\n\n';
            if (lastSession.summary) {
              output += `**Last Session:** ${lastSession.summary}\n\n`;
            }
            if (lastSession.work_in_progress) {
              output += `**Work in Progress:** ${lastSession.work_in_progress}\n\n`;
            }
            if (lastSession.next_steps) {
              output += `**Next Steps:** ${lastSession.next_steps}\n\n`;
            }
          }

          if (decisions.length > 0) {
            output += '## Key Decisions\n\n';
            decisions.forEach(d => {
              output += `- **${d.topic}:** ${d.decision}\n`;
            });
            output += '\n';
          }

          if (prefs.length > 0) {
            output += '## Preferences\n\n';
            prefs.forEach(p => {
              output += `- **${p.category}/${p.key}:** ${p.value}\n`;
            });
            output += '\n';
          }

          if (questions.length > 0) {
            output += '## Open Questions\n\n';
            questions.forEach(q => {
              output += `- [#${q.id}] ${q.question}\n`;
            });
            output += '\n';
          }

          if (output) {
            console.log(output.trim());
          } else {
            console.log('No previous context found.');
          }
        }

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(`[Pensieve] Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('status')
    .description('Show database status and counts')
    .action(async () => {
      try {
        const db = await MemoryDatabase.create();

        const stats = db.getMemoryStats();
        const prefs = db.getAllPreferences();
        const lastSession = db.getLastSession();

        console.log('Pensieve Status');
        console.log('===============');
        console.log(`Database: ${db.getPath()}`);
        console.log('');
        console.log('Counts:');
        console.log(`  Decisions:      ${stats.decisions.active} active, ${stats.decisions.archived} archived`);
        console.log(`  Preferences:    ${prefs.length}`);
        console.log(`  Discoveries:    ${stats.discoveries.active} active, ${stats.discoveries.archived} archived`);
        console.log(`  Entities:       ${stats.entities.active} active, ${stats.entities.archived} archived`);
        console.log(`  Open Questions: ${stats.open_questions.active} active, ${stats.open_questions.archived} archived`);
        console.log('');
        if (lastSession) {
          console.log('Last Session:');
          console.log(`  Started: ${lastSession.started_at}`);
          console.log(`  Ended:   ${lastSession.ended_at || 'In progress'}`);
          if (lastSession.summary) {
            console.log(`  Summary: ${lastSession.summary.substring(0, 80)}${lastSession.summary.length > 80 ? '...' : ''}`);
          }
        } else {
          console.log('No sessions recorded yet.');
        }

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(`[Pensieve] Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('archive')
    .description('Archive (soft-delete) old memory entries')
    .option('-d, --days <number>', 'Archive entries older than N days', parseInt)
    .option('-t, --tables <tables...>', 'Tables to operate on (decisions, discoveries, entities, open_questions)')
    .option('--list', 'Show archived entry counts')
    .option('--restore-all', 'Restore all archived entries')
    .action(async (options) => {
      try {
        const db = await MemoryDatabase.create();

        if (options.list) {
          const stats = db.getMemoryStats();
          console.log('Archived Entries');
          console.log('================');
          console.log(`  Decisions:      ${stats.decisions.archived}`);
          console.log(`  Discoveries:    ${stats.discoveries.archived}`);
          console.log(`  Entities:       ${stats.entities.archived}`);
          console.log(`  Open Questions: ${stats.open_questions.archived}`);
          db.close();
          process.exit(0);
          return;
        }

        if (options.restoreAll) {
          const results = db.restoreAll(options.tables);
          const total = results.reduce((sum: number, r: any) => sum + r.affected, 0);
          console.log(`Restored ${total} archived entries:`);
          results.forEach((r: any) => console.log(`  - ${r.table}: ${r.affected}`));
          db.close();
          process.exit(0);
          return;
        }

        if (options.days === undefined) {
          console.error('Error: Provide --days, --list, or --restore-all');
          process.exit(1);
          return;
        }

        const results = db.archiveOlderThan(options.days, options.tables);
        const total = results.reduce((sum: number, r: any) => sum + r.affected, 0);
        console.log(`Archived ${total} entries older than ${options.days} days:`);
        results.forEach((r: any) => console.log(`  - ${r.table}: ${r.affected}`));

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(`[Pensieve] Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command('prune')
    .description('Permanently delete old memory entries')
    .option('-d, --days <number>', 'Delete entries older than N days', parseInt)
    .option('-t, --tables <tables...>', 'Tables to operate on (decisions, discoveries, entities, open_questions)')
    .option('--archived-only', 'Only delete archived entries')
    .option('--purge-archived', 'Delete all archived entries')
    .option('-y, --yes', 'Confirm destructive operation (required)')
    .action(async (options) => {
      try {
        if (!options.yes) {
          console.error('Error: Add --yes to confirm. This permanently deletes data.');
          process.exit(1);
          return;
        }

        const db = await MemoryDatabase.create();

        if (options.purgeArchived) {
          const results = db.purgeArchived(options.tables);
          const total = results.reduce((sum: number, r: any) => sum + r.affected, 0);
          console.log(`Permanently deleted ${total} archived entries:`);
          results.forEach((r: any) => console.log(`  - ${r.table}: ${r.affected}`));
          db.close();
          process.exit(0);
          return;
        }

        if (options.days === undefined) {
          console.error('Error: Provide --days or --purge-archived');
          process.exit(1);
          return;
        }

        const results = db.pruneOlderThan(options.days, options.tables, options.archivedOnly);
        const total = results.reduce((sum: number, r: any) => sum + r.affected, 0);
        console.log(`Permanently deleted ${total} entries older than ${options.days} days${options.archivedOnly ? ' (archived only)' : ''}:`);
        results.forEach((r: any) => console.log(`  - ${r.table}: ${r.affected}`));

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(`[Pensieve] Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program.parse();
}
