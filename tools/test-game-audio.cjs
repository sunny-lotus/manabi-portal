const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('../../manabiquest-work/node_modules/jsdom');
const root = path.resolve(__dirname, '..');
const exportsRoot = path.resolve(root, '../exports/three-games-audio-canva');
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(id, deferred = false) {
  const html = fs.readFileSync(path.join(exportsRoot, id, `${id}-canva.html`), 'utf8');
  const errors = [], starts = [], pending = [], contexts = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, { url: `https://school.example/${id}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const w = dom.window;
  class Param {
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.gain = new Param(); this.playbackRate = new Param(); }
    connect() {}
    disconnect() {}
    start(time) { this.startTime = time; starts.push(this); }
    stop() { this.stopped = true; this.onended?.(); }
  }
  class AudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; contexts.push(this); }
    async resume() { this.state = 'running'; }
    createGain() { return new Node(); }
    createBufferSource() { return new Node(); }
    createDynamicsCompressor() {
      const node = new Node();
      for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[name] = new Param();
      return node;
    }
    async decodeAudioData(bytes) { return { duration: bytes.byteLength > 100000 ? 120 : .5 }; }
  }
  let fetches = 0;
  w.fetch = async url => {
    assert.match(url, /^data:audio\/(mpeg|wav);base64,/);
    fetches++;
    if (deferred) await new Promise(resolve => pending.push(resolve));
    return { ok: true, arrayBuffer: async () => Buffer.from(url.split(',')[1], 'base64') };
  };
  Object.assign(w, { AudioContext, TextEncoder, TextDecoder, scrollTo() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.eval([...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n') + '\nwindow.testRun=code=>eval(code);');
  return { w, d: w.document, errors, starts, pending, contexts, fetches: () => fetches, close: () => w.close() };
}

(async () => {
  for (const id of ['team-challenge', 'sentence-hunter', 'jukugo-clinic']) {
    const s = setup(id), { w, d } = s;
    try {
      assert.equal(s.fetches(), 0, 'Initial silent load');
      w.testRun('home()');
      d.getElementById('sndBtn').click();
      await settle(); await settle();
      assert.equal(s.contexts.length, 1);
      assert.equal(s.starts.filter(voice => voice.buffer.duration === 120).length, 1, 'One music voice');
      const before = s.starts.length;
      w.testRun(id === 'sentence-hunter' ? 'beep("ok")' : 'snd.ok()');
      await settle();
      assert(s.starts.length > before, 'Correct-answer sample plays');
      const nextLoop = s.starts.find(voice => voice.buffer.duration === 120);
      assert(nextLoop);
      s.contexts[0].currentTime = 119;
      await new Promise(resolve => setTimeout(resolve, 280));
      const loops = s.starts.filter(voice => voice.buffer.duration === 120);
      assert.equal(loops.length, 2, 'Next loop scheduled');
      assert(Math.abs(loops[1].startTime - loops[0].startTime - 119.3) < .001, 'Overlap, no silent gap');
      const bgm = d.querySelector('[data-setting="bgm"]');
      bgm.checked = false; bgm.dispatchEvent(new w.Event('input'));
      assert(loops.every(voice => voice.stopped), 'BGM off stops both scheduled loops');
      const se = d.querySelector('[data-setting="se"]');
      se.checked = false; se.dispatchEvent(new w.Event('input'));
      const mutedCount = s.starts.length;
      w.testRun(id === 'sentence-hunter' ? 'shot()' : 'snd.ok()');
      await settle(); assert.equal(s.starts.length, mutedCount, 'Independent SE off');
      bgm.checked = true; bgm.dispatchEvent(new w.Event('input'));
      await settle();
      Object.defineProperty(d, 'hidden', { configurable: true, value: true });
      d.dispatchEvent(new w.Event('visibilitychange'));
      assert(s.starts.every(voice => voice.stopped), 'Hidden page is silent');
      Object.defineProperty(d, 'hidden', { configurable: true, value: false });
      d.dispatchEvent(new w.Event('visibilitychange'));
      await settle();
      assert(s.starts.some(voice => !voice.stopped && voice.buffer.duration === 120));
      d.getElementById('sndBtn').click();
      assert(s.starts.every(voice => voice.stopped), 'Master OFF silences all voices');
      assert.equal(d.getElementById('sndBtn').textContent, '音 OFF');
      const credits = d.querySelector('.learning-sound-dialog').textContent;
      assert(credits.includes('Kevin MacLeod') && credits.includes('CC0') && credits.includes('Attribution 4.0'));
      assert.deepEqual(s.errors, []);
      console.log(`PASS ${id}: embedded media, playback, crossfade, independent mute, visibility and credits`);
    } finally { s.close(); }
  }
  const race = setup('team-challenge', true);
  try {
    race.d.getElementById('sndBtn').click();
    await settle();
    race.d.getElementById('sndBtn').click();
    for (const resolve of race.pending) resolve();
    await settle(); await settle();
    assert.equal(race.starts.length, 0, 'No late sound after muting during load');
    race.d.getElementById('sndBtn').click();
    await settle(); await settle();
    assert(race.starts.some(voice => voice.buffer.duration === 120));
    assert.deepEqual(race.errors, []);
    console.log('PASS rapid ON/OFF during asynchronous load and cached restart');
  } finally { race.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
