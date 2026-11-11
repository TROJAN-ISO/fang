// Companion window behaviour. Talks to the main process only through window.companion.
(() => {
  const api = window.companion;
  const body = document.body;
  const stage = document.getElementById('stage');
  const buddy = document.getElementById('buddy');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const steps = document.getElementById('steps');
  const stepLabel = document.getElementById('step-label');

  const BUSY = new Set(['thinking', 'working', 'worried']);
  const STICKY = new Set(['error', 'blocked']);
  const SLEEP_AFTER = 10 * 60 * 1000;
  const NO_WALK = new Set(['sleep', 'error', 'blocked']);

  // Capri sprite clips: [frames, fps, columns]. Sizes from Capri's clips.json (240x384 cells).
  const CLIPS = {
    idle: [16, 8], blink: [4, 8], blink_glitch: [4, 8], glitch: [10, 15], dangle: [24, 10, 17],
    dance: [16, 16], arrive: [14, 15], grin: [16, 8], sleep: [16, 6], wake: [13, 15],
  };
  // Each mood: [one-shot intro or null, looping clip].
  const MOOD_CLIPS = {
    idle: [null, 'idle'], thinking: [null, 'idle'], hello: ['arrive', 'idle'], working: [null, 'dance'],
    worried: [null, 'blink_glitch'], success: ['grin', 'idle'], happy: ['grin', 'idle'],
    error: ['glitch', 'blink_glitch'], blocked: [null, 'blink_glitch'], sleep: [null, 'sleep'],
  };
  const CELL = { w: 120, h: 192 };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let clipTimer = null;
  let clipName = '';

  // Play a clip; loop it, or play once then call done.
  function play(name, done) {
    clearInterval(clipTimer);
    clipName = name;
    const [count, fps, cols = count] = CLIPS[name];
    const rows = Math.ceil(count / cols);
    buddy.style.backgroundImage = `url(sprites/${name}.png)`;
    buddy.style.backgroundSize = `${cols * CELL.w}px ${rows * CELL.h}px`;
    let f = 0;
    const draw = () => { buddy.style.backgroundPosition = `${-(f % cols) * CELL.w}px ${-Math.floor(f / cols) * CELL.h}px`; };
    draw();
    if (still) { if (done) done(); return; }
    clipTimer = setInterval(() => {
      f++;
      if (f >= count) { if (done) { clearInterval(clipTimer); done(); return; } f = 0; }
      draw();
    }, 1000 / fps);
  }

  function playMood(m, from) {
    if (body.classList.contains('held')) return;
    const [intro, loop] = MOOD_CLIPS[m] || MOOD_CLIPS.idle;
    const first = from === 'sleep' && m !== 'sleep' ? 'wake' : intro;
    if (first) play(first, () => play(loop)); else play(loop);
  }

  let phases = ['Ticket', 'Repository', 'Branch', 'Implement', 'Changes'];
  let mood = 'idle';
  let bubbleTimer = null;
  let moodTimer = null;
  let lastActivity = Date.now();

  // ---------- mood and speech ----------
  function setMood(next) {
    clearTimeout(moodTimer);
    const prev = mood;
    mood = next;
    playMood(next, prev);
    body.dataset.mood = next;
    api.canWalk(!still && !NO_WALK.has(next));
    lastActivity = Date.now();
    // Short-lived moods settle back to idle on their own.
    if (next === 'hello') moodTimer = setTimeout(() => setMood('idle'), 1200);
    if (next === 'success' || next === 'happy') moodTimer = setTimeout(() => setMood('idle'), 8000);
  }

  function speak(text, hold) {
    clearTimeout(bubbleTimer);
    if (!text) { hideBubble(); return; }
    bubbleText.textContent = text;
    bubble.hidden = false;
    if (!hold) bubbleTimer = setTimeout(hideBubble, Math.min(12000, 3500 + text.length * 45));
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    bubble.hidden = true;
  }

  api.on('state', ({ mood: m, text, hold }) => {
    setMood(m);
    speak(text, hold || STICKY.has(m));
  });

  api.on('config', cfg => {
    if (cfg.scale) stage.style.transform = `scale(${cfg.scale})`;
    if (cfg.phases) { phases = cfg.phases; renderSteps(0); }
  });

  api.on('phase', n => renderSteps(n));

  // The main process moves the window; here she dances along, facing where she's going.
  api.on('walk', dir => {
    if (dir) { buddy.classList.toggle('face-left', dir < 0); if (clipName !== 'dance') play('dance'); }
    else playMood(mood);
  });

  // ---------- perch stepper ----------
  function renderSteps(current) {
    steps.replaceChildren(...phases.map((name, i) => {
      const li = document.createElement('li');
      li.title = name;
      if (i < current) li.className = 'done';
      if (i === current) li.className = 'now';
      return li;
    }));
    stepLabel.textContent = `Step ${current + 1} of ${phases.length}: ${phases[current]}`;
  }

  // ---------- blinking and napping ----------
  (function blinkLoop() {
    setTimeout(() => {
      if ((mood === 'idle' || mood === 'thinking') && clipName === 'idle') play('blink', () => play('idle'));
      blinkLoop();
    }, 2500 + Math.random() * 3500);
  })();

  setInterval(() => {
    if (mood === 'idle' && Date.now() - lastActivity > SLEEP_AFTER) { setMood('sleep'); hideBubble(); }
  }, 30000);

  // ---------- mouse: only the character, bubble and perch catch clicks ----------
  let hovering = false;
  function setHover(over) {
    if (over === hovering) return;
    hovering = over;
    api.hover(over);
  }
  document.addEventListener('mousemove', e => {
    setHover(!!e.target.closest('.hit') || dragging);
    trackPat(e);
  });
  document.addEventListener('mouseleave', () => { if (!dragging) setHover(false); });

  // Drag her anywhere; a plain click opens FANG.
  let down = null;
  let dragging = false;
  let moodBeforeDrag = null;

  buddy.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
  });
  document.addEventListener('mousemove', e => {
    if (!down || dragging) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      dragging = true;
      moodBeforeDrag = mood;
      body.classList.add('held');
      play('dangle');
      api.dragStart();
    }
  });
  document.addEventListener('mouseup', e => {
    if (e.button !== 0 || !down) return;
    const wasDragging = dragging;
    down = null;
    if (wasDragging) {
      dragging = false;
      body.classList.remove('held');
      api.dragEnd();
      if (mood === 'sleep') setMood('idle');
      else setMood(moodBeforeDrag || 'idle');
      playMood(mood);
      return;
    }
    // Click: wake up, clear the bubble and bring FANG to the front.
    if (mood === 'sleep') { setMood('idle'); speak('Oh. Hi.'); return; }
    if (STICKY.has(mood)) setMood('idle');
    hideBubble();
    api.click();
  });

  bubble.addEventListener('click', () => {
    hideBubble();
    if (STICKY.has(mood)) setMood('idle');
  });

  document.addEventListener('contextmenu', e => {
    if (!e.target.closest('.hit')) return;
    e.preventDefault();
    api.menu();
  });

  // ---------- head pats: rub the cursor back and forth over her ----------
  let lastX = null;
  let lastDir = 0;
  let flips = [];
  function trackPat(e) {
    if (down || !e.target.closest('#buddy')) { lastX = null; return; }
    if (lastX !== null) {
      const dir = Math.sign(e.screenX - lastX);
      if (dir && dir !== lastDir) {
        const now = Date.now();
        flips = flips.filter(t => now - t < 1200);
        flips.push(now);
        lastDir = dir;
        if (flips.length >= 6 && !BUSY.has(mood) && !STICKY.has(mood)) {
          flips = [];
          setMood('happy');
          speak(['Hey. That\'s nice.', 'Okay, okay.', 'Back to work, you.'][Math.floor(Math.random() * 3)]);
        }
      }
    }
    lastX = e.screenX;
  }

  renderSteps(0);
  playMood('idle');
  api.canWalk(!still);
})();
