# FANG

A phase-by-phase desktop workbench for turning Jira tickets into code, for Mac and Windows.

FANG drives your own Claude Code setup:

- **jira-to-code** reads and plans the ticket
- **Raphael** implements the approved plan

**FANG never commits and never pushes.** Every change stays on disk for you to review and commit yourself.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- Git on your PATH
- Internet access for `npm install` the first time (it downloads Electron and `word-extractor`, the library that reads Word files)
- Claude Code installed and logged in (run `claude` once in a terminal to confirm)
- Installed in `~/.claude/`: the `jira-to-code` skill, the `raphael` agent, and the caveman and ponytail plugins

## Run it

```bash
cd fang
npm install
npm start
```

## Build an installable app

Build on the platform you're targeting:

```bash
npm run dist:mac   # on a Mac  → dist/FANG-x.y.z.dmg
npm run dist:win   # on Windows → dist/FANG Setup x.y.z.exe
```

The builds are unsigned. On a Mac, right-click FANG and choose Open the first time. On Windows, choose "More info → Run anyway" in SmartScreen.

## How it works

**Tickets (Jira sync, read-only)** — copy `.env.example` to `.env` (project folder, or the app's data folder for the installed app) and fill in `JIRA_BASE_URL` (just the site, e.g. `https://your-site.atlassian.net`), `JIRA_EMAIL` and `JIRA_API_TOKEN`. **Sync from Jira** fetches the issues assigned to you in `JIRA_FILTER` (default "Ready for Sprint - Team John"): a saved filter by that name, otherwise the sprint by that name. They're saved as `<KEY>.json` in FANG's own data folder (`jira-sync/`), and that folder is the only place FANG reads tickets from. FANG only sends GET requests to Jira: it never creates, edits, transitions, comments on or deletes an issue. Issues that leave the sprint or are reassigned are removed from `jira-sync/` locally only.

**Repositories** — choose a folder and FANG finds every git repository in it (up to two levels deep), showing its branch, uncommitted changes and whether `develop` exists.

**Development** — five phases shown as a row of circles (Phase 1 › Phase 2 › … › Phase 5). One phase is on screen at a time: click a circle or use Back / Next to move between them. Finished phases turn green with a check, the current one is highlighted, locked ones are dimmed, and a phase working in the background pulses.

1. **Choose a ticket.** jira-to-code runs Phase 1 in the background. Review the parse (Checkpoint 1) and add notes or corrections for the planner.
2. **Choose a repository.** As soon as the ticket is read and a repository is chosen, jira-to-code plans Phases 2–4 in the background (read-only), exploring only the parts of the repository the ticket touches.
3. **Create a branch from develop.** The name is prefilled (`feature/PROJ-123-short-title`) and you can change it. Choose `origin/develop` (optionally fetched first) or local `develop`. The branch gets no upstream.
4. **Review the brief and implement.** You see the plan brief, the codebase brief (jira-to-code's codebase summary) and the full plan. Pressing **Implement** is your plan approval (Checkpoint 3); Raphael then writes the code and tests. If Raphael gets blocked, answer him in FANG and he continues in the same session.
5. **File changes.** Every changed file with +/− counts and a diff, Raphael's implementation summary and PR description, and a safety check showing no commits were made and nothing was pushed.

## Safety

FANG blocks commits and pushes at three levels:

1. **FANG's own git code** can only read state and create branches. `commit`, `push`, `merge`, `rebase`, `reset`, `stash`, `checkout` and more are hard-blocked.
2. **Every Claude Code run** gets a deny list: `git commit`, `push`, `merge`, `rebase`, `reset`, `clean`, `checkout`, `switch`, `stash`, `pull`, `gh`, dependency installs (`composer require/update/install`, `npm install`, …), `rm -r` and `sudo`. Deny rules always win over allow rules. FANG never uses `--dangerously-skip-permissions`.
3. **Raphael's own rules**, plus a check after every run that HEAD didn't move and the branch has no upstream.

Planning runs are read-only. Only implementation may edit files.

Raphael may run tests, linters and type checks (Pest, PHPUnit, PHPStan, `php artisan test`, npm/pnpm/yarn test, tsc, vitest, jest, eslint). Add other commands in **Settings → Extra commands Raphael may run**. Blocked commands stay blocked even if you add them there.

## Troubleshooting

- **"Claude Code not found"**: set the full path in Settings. Find it with `which claude` (Mac) or `where claude` (Windows).
- **A run stops early**: Claude tried a command that isn't allowed. The log shows it. Add it under Settings if it's safe.
- **The plan didn't start**: it waits for the ticket to be read (phase 1) and a repository to be chosen (phase 2). Check phase 1 for errors.
- **"uncommitted change(s)" when creating a branch**: commit or stash your work first. FANG won't do it for you.
# fang
