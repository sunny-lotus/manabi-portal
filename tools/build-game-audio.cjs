const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const games = [
  { id: 'team-challenge', title: 'Carefree', track: 'team', isrc: 'USUAN1400037' },
  { id: 'sentence-hunter', title: 'Investigations', track: 'hunter', isrc: 'USUAN1100646' },
  { id: 'jukugo-clinic', title: 'Local Forecast', track: 'clinic', isrc: 'USUAN1300010' },
];
const effects = ['correct', 'retry', 'click', 'select', 'complete', 'back', 'wood', 'rattle'];
const enginePath = path.join(root, 'common/audio/three-games.js');
const engine = fs.readFileSync(enginePath, 'utf8');
const exportRoot = path.resolve(root, '../exports/three-games-audio-canva');
fs.mkdirSync(exportRoot, { recursive: true });
const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const manifest = [];

for (const game of games) {
  const file = path.join(root, game.id, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const assets = { bgm: `../common/audio/three-games/${game.track}-bgm.mp3` };
  for (const name of effects) assets[name] = `../common/audio/three-games/${name}.wav`;
  const settings = { id: game.id, title: game.title, assets };
  const init = `const gameSound = createLearningAudio(${JSON.stringify(settings)});\n`;
  let adapter;
  if (game.id === 'team-challenge') {
    adapter = `const snd = {
  ok: () => gameSound.effect('correct'),
  ng: () => gameSound.effect('retry'),
  tick: () => gameSound.effect('click'),
  fan: () => gameSound.effect('complete'),
  roll: () => gameSound.effect('wood', { repeats: 5, gap: .075, gain: .55 }),
  crash: () => gameSound.effect('rattle', { gain: .65 })
};`;
  } else if (game.id === 'sentence-hunter') {
    adapter = `function beep(kind) {
  const effects = { ok: 'correct', ng: 'retry', win: 'complete', end: 'back' };
  void gameSound.effect(effects[kind] || 'click');
}
function shot() { void gameSound.effect('correct'); }`;
  } else {
    adapter = `const snd = {
  ok: () => gameSound.effect('correct'),
  ng: () => gameSound.effect('retry'),
  in: () => gameSound.effect('select'),
  end: () => gameSound.effect('back'),
  win: () => gameSound.effect('complete')
};`;
  }
  const previous = /\/\* ---- 音（ファイルなし） ---- \*\/[\s\S]*?\$\("sndBtn"\)\.onclick = [^\n]+;/;
  const installed = /\/\* recorded-audio-start \*\/[\s\S]*?\/\* recorded-audio-end \*\//;
  const replacement = `/* recorded-audio-start */\n${init}${adapter}\n/* recorded-audio-end */`;
  if (previous.test(html)) html = html.replace(previous, () => replacement);
  else if (installed.test(html)) html = html.replace(installed, () => replacement);
  else throw Error(`Cannot locate the audio adapter in ${game.id}`);
  if (!html.includes('src="../common/audio/three-games.js"')) {
    html = html.replace(/<script>\s*\/\* ----/, '<script src="../common/audio/three-games.js"></script>\n<script>\n/* ----');
    if (!html.includes('src="../common/audio/three-games.js"')) {
      // The game script starts with utility definitions, following the embedded QR library.
      const offset = html.indexOf('/* recorded-audio-start */');
      const scriptStart = html.lastIndexOf('<script>', offset);
      if (scriptStart < 0) throw Error('Game script not found');
      html = html.slice(0, scriptStart) + '<script src="../common/audio/three-games.js"></script>\n' + html.slice(scriptStart);
    }
  }
  fs.writeFileSync(file, html);

  let standalone = html.replace('<script src="../common/audio/three-games.js"></script>', () => `<script>\n${safeScript(engine)}\n</script>`);
  const embeddedAssets = {};
  for (const [name, url] of Object.entries(assets)) {
    const bytes = fs.readFileSync(path.resolve(root, game.id, url));
    embeddedAssets[name] = `data:audio/${name === 'bgm' ? 'mpeg' : 'wav'};base64,${bytes.toString('base64')}`;
  }
  standalone = standalone.replace(init, () => `const gameSound = createLearningAudio(${JSON.stringify({ ...settings, assets: embeddedAssets })});\n`);
  for (const [, script] of standalone.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script);
  const bytes = Buffer.byteLength(standalone);
  if (bytes >= 10000000) throw Error(`${game.id} exceeds 10 MB`);
  const folder = path.join(exportRoot, game.id);
  fs.mkdirSync(folder, { recursive: true });
  for (const ext of ['html', 'txt']) fs.writeFileSync(path.join(folder, `${game.id}-canva.${ext}`), standalone);
  manifest.push({ game: game.id, track: game.title, bytes, sha256: crypto.createHash('sha256').update(standalone).digest('hex') });
}
fs.writeFileSync(path.join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(manifest);
