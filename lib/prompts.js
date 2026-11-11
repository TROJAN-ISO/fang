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

// Reviews flow. Veronica normally fixes comments on your own PRs; here she only reviews someone else's.
const REVIEW_MODE = `REVIEW-ONLY MODE: you are reviewing another developer's pull request. ` +
  `Do NOT edit, create or delete files, do not run formatters or tests, and do not apply fixes. ` +
  `Read code only. FANG posts the review itself after the user approves it.`;

const prContext = pr => `Pull request: ${pr.slug}#${pr.number} "${pr.title}" by ${pr.author}
Base branch: ${pr.base} · Head: ${pr.headRef} @ ${pr.headSha}
The current directory is a detached checkout of the PR head. Read, Glob and Grep show the code exactly as the PR leaves it.
See the PR's changes with: git diff ${pr.baseRef}...${pr.ref}
Changed files: ${pr.files.map(f => `${f.path} (+${f.add} −${f.del})`).join(', ')}

PR description:
${pr.body || '(none)'}`;

const FINDING_RULES = `- Only report real defects introduced or touched by this PR: bugs, security holes, data loss, broken
  behaviour, missing validation at trust boundaries, N+1 queries, violations of the repository's own CLAUDE.md rules.
- No style nitpicks a formatter would fix, no speculation, no "consider" suggestions without a concrete failure.
- Every finding needs evidence you read in the code: the exact file and line in the NEW version of the file
  (line numbers as they are in this checkout), and a concrete failure scenario.
- severity: "blocker" (must not merge), "major" (real bug, should fix), "minor" (small but real issue).`;

function reviewFind(pr) {
  return `${REVIEW_MODE}

${FANG_MODE}

${prContext(pr)}

Read the repository's CLAUDE.md if it exists, then review the diff. Open surrounding code and callers as needed
to understand the change; don't stop at the diff.

${FINDING_RULES}

End your reply with a line containing only "FANG REVIEW JSON" followed by one JSON object and nothing after it:
{"summary":"2-4 sentences on what the PR does and its overall quality",
 "findings":[{"id":1,"path":"app/Foo.php","line":42,"severity":"major","title":"short title",
   "problem":"what is wrong and the concrete failure","fix":"what the author should change","evidence":"the code you read"}]}
Use "findings":[] if the PR is good.`;
}

function reviewVerify(pr, findings) {
  return `${REVIEW_MODE}

${FANG_MODE}

${prContext(pr)}

You are the verifier. Another reviewer reported the findings below. Your job is to prevent false accusations.
For EACH finding, open the cited file and line in this checkout, read the surrounding code and callers, and decide:
- "confirmed": the defect is real, in this PR's code, and the failure scenario actually happens.
- "rejected": the code doesn't say that, it's handled elsewhere, the line is wrong, it's speculative, or it's only style.
Be skeptical: when unsure, reject. If the defect is real but the line is off, confirm it with the correct line.

FINDINGS TO VERIFY:
${JSON.stringify(findings, null, 2)}

End your reply with a line containing only "FANG VERIFY JSON" followed by one JSON object and nothing after it:
{"results":[{"id":1,"verdict":"confirmed","line":42,"reason":"one sentence citing the code"}]}`;
}

module.exports = { parse, plan, implement, continueImplement, reviewFind, reviewVerify };
