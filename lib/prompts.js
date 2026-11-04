// Prompts FANG sends to your skills and agent.
// FANG replaces jira-to-code's chat checkpoints with its own screens:
//   Checkpoint 1 → you review the ticket parse in step 1
//   Checkpoint 3 → the Implement button in step 4

const FANG_MODE = `FANG app mode: you are running headless inside the FANG desktop app. ` +
  `There is no chat. The user reviews and approves everything in FANG, so never stop to ask a question ` +
  `or wait for confirmation; finish the task and return the requested output.`;

function parse(ticket) {
  return `Use the jira-to-code skill.

${FANG_MODE}

Run Phase 1 (INGEST) only for the ticket below. Do not explore any codebase and do not plan.
Output the full TICKET PARSE OUTPUT block in the skill's exact format and nothing after it.
FANG shows it to the user as Checkpoint 1.

Ticket source file: ${ticket.rel}
----- TICKET START -----
${ticket.content}
----- TICKET END -----`;
}

function plan({ ticket, parseText, notes }) {
  return `Use the jira-to-code skill in Handoff Mode (plan only: Phases 1–4, no code).

${FANG_MODE}

- Checkpoint 1 is done: the user confirmed the Ticket Parse Output below in FANG.
- The user pre-approves Checkpoint 2 for this run.
- Checkpoint 3 (plan approval) happens in FANG via the Implement button, so do not ask for it.
- Phase 2: keep exploration targeted. Read the manifest and only the areas this ticket touches; don't scan the whole project.
- Do not create, edit or delete any files. Do not switch branches.
${notes ? `\nUser notes and corrections (apply these):\n${notes}\n` : ''}
TICKET PARSE OUTPUT (confirmed):
${parseText}

Original ticket (${ticket.rel}):
----- TICKET START -----
${ticket.content}
----- TICKET END -----

Output, in this order, in the skill's exact formats:
1. CODEBASE SUMMARY
2. The Reconcile output (AC gap analysis + COMPLEXITY block)
3. IMPLEMENTATION PLAN
4. A final section that starts with a line containing only "FANG BRIEF", followed by 3–6 short lines:
   what will change, complexity, the main risks, and any open questions with the default you'd use.`;
}

function implement({ ticket, parseText, planText, branch, notes }) {
  return `APPROVED PLAN HANDOFF

${FANG_MODE}

The user approved this plan in FANG by pressing Implement.
Branch: ${branch} (already created from develop and checked out by FANG; do not switch branches)
"Just do it": yes. No checkpoints. If you are blocked, return a RAPHAEL BLOCKED block.
Never commit, push, merge, rebase or stash. Leave every change uncommitted on disk.
${notes ? `\nUser notes and Open Question answers:\n${notes}\n` : '\nOpen Questions: use the plan\'s suggested defaults.\n'}
1. TICKET PARSE OUTPUT
${parseText}

2. CODEBASE SUMMARY, RECONCILE OUTPUT AND APPROVED IMPLEMENTATION PLAN
${planText}

3. Original ticket (${ticket.rel})
----- TICKET START -----
${ticket.content}
----- TICKET END -----

Plan is approved. Skip Phases 1–4. Follow this implementation plan exactly, respecting all file paths,
patterns, AC mappings, and rollback notes, under the Phase 5 rules of jira-to-code.
Return the IMPLEMENTATION SUMMARY and PR DESCRIPTION, or a RAPHAEL BLOCKED block if you cannot continue.`;
}

function continueImplement({ answer }) {
  return `${FANG_MODE}

The user answered your RAPHAEL BLOCKED report in FANG:
${answer}

Continue the approved plan from the blocked step. Same rules: no commits, no pushes, no branch switching.
Return the IMPLEMENTATION SUMMARY and PR DESCRIPTION, or another RAPHAEL BLOCKED block.`;
}

module.exports = { parse, plan, implement, continueImplement };
