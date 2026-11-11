# FANG commands

## Voice

Hold **Option+Space** (Alt+Space on Windows), or click the mic button in the sidebar. Speak, then let go.

- **A text field has focus** (notes, your answer to Raphael, ticket search): your words get typed into it.
- **No text field has focus:** your words run as a command.

Upper/lower case and punctuation don't matter. Commands must be said as written, except the ones that end in a name or number.

### Pick work

| Say | Does |
|---|---|
| "develop ticket GEEK 12190" | Opens that ticket. "open ticket", "work on ticket" and "start ticket" also work. If no ticket ID matches, it looks for those words in ticket titles. |
| "use repo h69" | Selects that repository. "repository", "open repo" and "select repo" also work. Part of the name is enough. On the Reviews screen it picks the repository for the pull request instead. |
| "review PR 82" | Opens that pull request in Reviews. "review 82", "review pull request 82" also work. Only PRs waiting for your review count. If two repos have a PR with that number, the most recently updated one wins. |
| "develop another ticket" | Starts over with a new ticket. "another ticket", "new ticket" and "next ticket" also work. |

### Move around

| Say | Does |
|---|---|
| "next" | Next phase |
| "back" / "go back" | Previous phase |
| "phase 3" / "go to step two" | Jumps to that phase (1 to 5 in Development, 1 to 4 in Reviews, as a digit or a word) |
| "tickets" / "repositories" / "development" / "reviews" | Switches screens. You can put "go to", "show" or "open" in front. |

"next", "back" and "phase N" act on whichever screen you're on: Development or Reviews.

### Actions

Each action presses the matching button, so it only works when that button is on screen and not greyed out.

| Say | Does |
|---|---|
| "sync jira" | Syncs tickets from Jira |
| "create branch" | Creates the branch (Phase 3) |
| "implement" / "start implementation" | Starts Raphael. You still get the confirmation prompt. |
| "replan" | Plans again using your notes |
| "cancel" / "stop" | Cancels the running job |
| "refresh" / "refresh changes" | Reloads the file changes (Phase 5) |
| "send answer" / "continue" | Sends your answer to Raphael when he's blocked |

### Reviews

| Say | Does |
|---|---|
| "fetch reviews" / "fetch pull requests" | Reloads the PRs waiting for your review (Phase 1) |
| "review with veronica" / "start review" / "review again" | Starts Veronica's review (Phase 3). Verification runs on its own afterwards. |
| "verify again" | Re-runs the verification if it failed |
| "post review" / "post approval" / "post comments" | Posts the review (Phase 4). You still get the confirmation prompt. |
| "review another" / "review another pr" / "next review" | Starts over with another pull request |
| "cancel" / "stop" | Stops Veronica or the verification |

If you say something that isn't a command, Fang shows what she heard plus "not a command". If the button isn't on screen right now, she says "not available here".

## Fang (the companion)

| Do this | What happens |
|---|---|
| Click her | Brings FANG to the front and clears her speech bubble |
| Drag her | Moves her. She dangles while you drag, and remembers where you drop her. |
| Right-click her | Menu: Open FANG, Quiet, Size (Small / Normal / Large), Nap, Hide |
| Rub the cursor back and forth over her | Head pats. She grins. |
| Click her speech bubble | Dismisses it |
| Cmd/Ctrl + Option/Alt + H | Hides or shows her |
| Cmd/Ctrl + Option/Alt + P | Quiet mode: no chatter, only failures and blocks |

The two shortcuts work in every app while FANG is open. On a Mac, Cmd+Option+H normally means "Hide Others", and FANG takes it over while it's running.

She naps after 5 minutes with no jobs running and no mouse or keyboard use in FANG's window. Using FANG again, a job event or clicking her wakes her. If you put her to sleep with **Nap**, only a job event or a click wakes her.

### What her moods mean

| Glow | Animation | Meaning |
|---|---|---|
| Mint | Idle, blinks now and then | Waiting |
| Blue | Idle, bubble says "Listening…" or what's happening | Listening to you, reading the ticket, planning, or Veronica reviewing and verifying |
| Amber | Dancing | Raphael is implementing |
| Green | Grin | Job done |
| Red | Glitch | Job failed |
| Orange | Glitchy blinking | A step inside the running job hit an error. The job keeps going. |
| Purple | Glitchy blinking | Raphael is blocked and needs your answer |
| Grey | Sleeping | Napping |
