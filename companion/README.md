# Fang, the FANG companion

A small desk buddy that sits on top of your windows and reacts to what FANG is doing:

- **Mood at a glance.** Her screen glows a different colour as she works:
  - mint when idle
  - blue while reading or planning
  - amber while Raphael implements
  - green when a job is done
  - red when a job fails
  - purple when Raphael is blocked and needs your answer
- **Speech bubble.** Tells you what just happened. It narrates Raphael's progress at most once every 6 seconds.
- **Perch.** She sits on a mini version of the Development stepper, showing which of the 5 steps you're on.
- **Gets your attention.** When a job finishes, fails or gets blocked while FANG is in the background, the FANG icon flashes on Windows and bounces on Mac.
- **Read-only.** She never runs git, never starts jobs and never commits or pushes. She only listens to the jobs FANG already runs.

## Controls

| Do this | What happens |
|---|---|
| Click her | Opens FANG and clears the bubble |
| Drag her | Moves her anywhere. Her position is remembered |
| Right-click her | Menu: Open FANG, Quiet, Size, Nap, Hide |
| Rub the cursor back and forth over her | Head pats |
| Ctrl/Cmd + Alt + H | Hide or show her |
| Ctrl/Cmd + Alt + P | Quiet: no chatter, only failures and blocks |

She naps after 10 idle minutes. Clicks on empty parts of her window pass through to whatever is behind it. Settings are saved in `companion.json` in FANG's user-data folder.

## Wiring it into FANG

Copy the `companion/` folder into the FANG root, next to `main.js`. Then make these 4 small edits.

### 1. `main.js`: load her

Add this near the top:

```js
const companion = require('./companion/main');
```

Then, right after you create the main window:

```js
companion.create(win);
```

### 2. `main.js`: report jobs to her

In the `job:start` handler, after `const job = claude.run(opts);`, report the start and pass each event along:

```js
  companion.jobEvent(kind, 'start');
  job.on('log', entry => { send('log', { entry }); companion.jobEvent(kind, 'log', { entry }); });
  job.on('done', res => { jobs.delete(id); send('done', { result: res }); companion.jobEvent(kind, 'done', { result: res }); });
```

These replace your two existing `job.on(...)` lines.

### 3. `main.js` and `preload.js`: let the stepper tell her the step

In `main.js`:

```js
ipcMain.on('companion:phase', (_e, n) => companion.setPhase(n));
```

In `preload.js`, inside the `window.fang` object:

```js
  companionPhase: n => ipcRenderer.send('companion:phase', n),
```

### 4. Renderer: call it when the step changes

Wherever your Development stepper changes the current step (your Back/Next handlers, or `render()`), add this, passing the 0-based step index:

```js
window.fang.companionPhase(state.step);
```

Use whatever variable holds the current step.

### Build

Nothing to install. If your `package.json` `build.files` list is explicit, add `"companion/**"` to it so the folder ships in the installer.
