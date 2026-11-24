/* Recorded music and effects. Source and licence details accompany each game. */
window.createLearningAudio = function createLearningAudio(config) {
  const key = `learning-audio-${config.id}-v1`;
  const defaults = { enabled: false, bgm: true, se: true, musicVolume: 18, effectVolume: 50 };
  const prefs = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const name of Object.keys(defaults)) {
      if (typeof saved?.[name] !== typeof defaults[name]) continue;
      prefs[name] = typeof saved[name] === 'number' && Number.isFinite(saved[name])
        ? Math.max(0, Math.min(100, saved[name])) : saved[name];
    }
  } catch (_) {}

  let context, musicGain, effectGain;
  let musicBuffer, nextMusicTime = 0, musicTimer, generation = 0;
  let leaving = false, ready = false, lastUnlockAttempt = 0;
  const cache = new Map(), musicVoices = new Set(), effectVoices = new Set();
  const button = document.getElementById('sndBtn');
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'chip';
  settingsButton.textContent = '音量';
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  button.after(settingsButton);
  const panel = document.createElement('dialog');
  panel.className = 'learning-sound-dialog';
  panel.innerHTML = `
    <h2>音の設定</h2>
    <label class="sound-switch"><input type="checkbox" data-setting="bgm">BGM</label>
    <label class="sound-slider">BGMの音量 <input type="range" data-setting="musicVolume" min="0" max="100" step="1"></label>
    <label class="sound-switch"><input type="checkbox" data-setting="se">効果音</label>
    <label class="sound-slider">効果音の音量 <input type="range" data-setting="effectVolume" min="0" max="100" step="1"></label>
    <p class="sound-status" role="status" aria-live="polite"></p>
    <details><summary>音源について</summary>
      <p>Music: “${config.title}” — Kevin MacLeod (<a href="https://incompetech.com/" target="_blank" rel="noopener">incompetech.com</a>). Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">Creative Commons Attribution 4.0</a>.</p>
      <p>配布元の楽曲を音量調整・MP3再変換し、再生時に末尾と冒頭を短く重ねています。</p>
      <p>効果音: <a href="https://kenney.nl/assets/interface-sounds" target="_blank" rel="noopener">Kenney Interface Sounds</a> / <a href="https://kenney.nl/assets/impact-sounds" target="_blank" rel="noopener">Impact Sounds</a> / <a href="https://kenney.nl/assets/rpg-audio" target="_blank" rel="noopener">RPG Audio</a> — <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0 1.0</a>。音量・長さ・鳴らす間隔を調整。</p>
    </details>
    <button type="button" class="sound-close">とじる</button>`;
  document.body.append(panel);
  const style = document.createElement('style');
  style.textContent = `
    .learning-sound-dialog{color:#30291e;background:#fffaf1;border:2px solid #59432a;border-radius:18px;width:min(360px,calc(100vw - 48px));max-height:80vh;overflow:auto;padding:22px;font:16px/1.6 system-ui,sans-serif;box-sizing:border-box}
    .learning-sound-dialog::backdrop{background:rgba(15,20,40,.55)}
    .learning-sound-dialog h2{margin:0 0 16px;font-size:21px}
    .learning-sound-dialog .sound-switch{display:flex;gap:10px;align-items:center;margin:14px 0 4px;font-weight:700}
    .learning-sound-dialog input[type=checkbox]{width:22px;height:22px;accent-color:#386c4c}
    .learning-sound-dialog .sound-slider{display:grid;gap:6px}
    .learning-sound-dialog input[type=range]{width:100%;height:30px;accent-color:#386c4c}
    .learning-sound-dialog details{font-size:13px;overflow-wrap:anywhere}
    .learning-sound-dialog summary{cursor:pointer;padding:10px 0}
    .learning-sound-dialog a{color:#245780;text-decoration:underline}
    .learning-sound-dialog .sound-close{margin-top:16px;padding:8px 22px;font:inherit;border:2px solid #59432a;border-radius:24px;background:#ffe293;color:#30291e;cursor:pointer}
    .learning-sound-dialog .sound-status{font-size:13px;min-height:1.6em;margin:6px 0}
  `;
  document.head.append(style);
  const status = panel.querySelector('.sound-status');

  function persist() {
    try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_) {}
    refresh();
  }
  function refresh() {
    button.textContent = prefs.enabled ? '音 ON' : '音 OFF';
    button.setAttribute('aria-pressed', String(prefs.enabled));
    for (const input of panel.querySelectorAll('[data-setting]')) {
      const value = prefs[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
    }
    if (context) {
      musicGain.gain.setTargetAtTime(prefs.enabled && prefs.bgm ? prefs.musicVolume / 100 : 0, context.currentTime, .06);
      effectGain.gain.setTargetAtTime(prefs.enabled && prefs.se ? prefs.effectVolume / 100 : 0, context.currentTime, .02);
    }
  }
  function audioContext() {
    if (context) return context;
    context = new (window.AudioContext || window.webkitAudioContext)();
    musicGain = context.createGain();
    effectGain = context.createGain();
    musicGain.gain.value = 0;
    effectGain.gain.value = 0;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 8;
    limiter.attack.value = .006;
    limiter.release.value = .12;
    musicGain.connect(limiter);
    effectGain.connect(limiter);
    limiter.connect(context.destination);
    refresh();
    return context;
  }
  async function buffer(name) {
    if (cache.has(name)) return cache.get(name);
    const pending = (async () => {
      const response = await fetch(config.assets[name]);
      if (!response.ok) throw Error('音源を読み込めませんでした');
      return audioContext().decodeAudioData(await response.arrayBuffer());
    })();
    cache.set(name, pending);
    try { return await pending; }
    catch (error) { cache.delete(name); throw error; }
  }
  function canPlay() {
    return prefs.enabled && !document.hidden && !leaving && context?.state === 'running';
  }
  function clearVoices(voices) {
    for (const source of voices) {
      try { source.stop(); } catch (_) {}
    }
    voices.clear();
  }
  function stop() {
    generation++;
    clearInterval(musicTimer);
    musicTimer = null;
    nextMusicTime = 0;
    clearVoices(musicVoices);
    clearVoices(effectVoices);
  }
  function scheduleMusic() {
    if (!canPlay() || !prefs.bgm || !prefs.musicVolume || !musicBuffer) return;
    while (nextMusicTime < context.currentTime + 1.2) {
      const start = Math.max(nextMusicTime, context.currentTime + .02);
      const fade = Math.min(.7, musicBuffer.duration / 8);
      const source = context.createBufferSource();
      const envelope = context.createGain();
      source.buffer = musicBuffer;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(1, start + fade);
      envelope.gain.setValueAtTime(1, start + musicBuffer.duration - fade);
      envelope.gain.linearRampToValueAtTime(0, start + musicBuffer.duration);
      source.connect(envelope);
      envelope.connect(musicGain);
      musicVoices.add(source);
      source.onended = () => { musicVoices.delete(source); source.disconnect(); envelope.disconnect(); };
      source.start(start);
      nextMusicTime = start + musicBuffer.duration - fade;
    }
  }
  function startMusic() {
    if (musicTimer || !canPlay() || !prefs.bgm || !prefs.musicVolume || !musicBuffer) return;
    nextMusicTime = context.currentTime + .03;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 250);
  }
  async function unlock() {
    if (!prefs.enabled || document.hidden || leaving) return;
    const token = generation;
    try {
      const ctx = audioContext();
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') throw Error('音 ONをもう一度おしてね');
      ready = true;
      refresh();
      if (!prefs.bgm || !prefs.musicVolume) return;
      status.textContent = musicBuffer ? '' : 'BGMを準備しています…';
      musicBuffer = await buffer('bgm');
      if (token !== generation || !canPlay()) return;
      startMusic();
      status.textContent = '';
    } catch (_) {
      if (token !== generation || !prefs.enabled) return;
      status.textContent = '音を準備できませんでした。「音 OFF」にして、もう一度ONにしてね。';
      button.textContent = '音 再試行';
    }
  }
  async function effect(name, options = {}) {
    if (!prefs.enabled || !prefs.se || !prefs.effectVolume || document.hidden || leaving) return;
    const token = generation;
    try {
      const ctx = audioContext();
      if (ctx.state !== 'running') await ctx.resume();
      const sample = await buffer(name);
      if (token !== generation || !canPlay() || !prefs.se || !prefs.effectVolume) return;
      const repeats = options.repeats || 1;
      const begin = ctx.currentTime + .01;
      for (let i = 0; i < repeats; i++) {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = sample;
        source.playbackRate.value = options.rate || 1;
        gain.gain.value = options.gain ?? 1;
        source.connect(gain);
        gain.connect(effectGain);
        effectVoices.add(source);
        source.onended = () => { effectVoices.delete(source); source.disconnect(); gain.disconnect(); };
        source.start(begin + i * (options.gap || .09));
      }
    } catch (_) {
      if (token === generation && prefs.enabled) status.textContent = '効果音を読み込めませんでした。音をONにし直してね。';
    }
  }
  button.onclick = () => {
    prefs.enabled = !prefs.enabled;
    stop();
    status.textContent = '';
    persist();
    if (prefs.enabled) { void unlock(); void effect('select'); }
  };
  settingsButton.onclick = () => { refresh(); panel.showModal(); };
  panel.querySelector('.sound-close').onclick = () => panel.close();
  for (const input of panel.querySelectorAll('[data-setting]')) {
    input.addEventListener('input', () => {
      prefs[input.dataset.setting] = input.type === 'checkbox' ? input.checked : Number(input.value);
      if (!prefs.enabled && ((input.type === 'checkbox' && input.checked) || (input.type === 'range' && Number(input.value) > 0))) prefs.enabled = true;
      if ((input.dataset.setting === 'bgm' && !prefs.bgm) || (input.dataset.setting === 'musicVolume' && !prefs.musicVolume)) {
        clearInterval(musicTimer); musicTimer = null; clearVoices(musicVoices);
      }
      if ((input.dataset.setting === 'se' && !prefs.se) || (input.dataset.setting === 'effectVolume' && !prefs.effectVolume)) clearVoices(effectVoices);
      persist();
      void unlock();
    });
  }
  for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, e => {
    if (!prefs.enabled || (ready && context?.state === 'running') || e.target.closest?.('#sndBtn') || performance.now() - lastUnlockAttempt < 300) return;
    lastUnlockAttempt = performance.now();
    void unlock();
  }, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else void unlock();
  });
  window.addEventListener('pagehide', () => { leaving = true; stop(); });
  window.addEventListener('pageshow', () => { leaving = false; void unlock(); });
  refresh();
  return { effect };
};
