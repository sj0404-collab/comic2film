/* Дымовой тест чистой логики (без браузера). */
import fs from 'node:fs';
import {
  secMsgGecValue, ssmlEscape, clusterBubbleWords, sortBubblesReadingOrder,
  trimSilence, sliceSegments, cleanMp3Frames, uuid, nowEdgeString, estimatePauseMs,
} from '../js/util.js';
import { buildTimeline, estimateSpeakDur } from '../js/engine.js';

let fails = 0;
function ok(cond, name) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) fails++;
}

/* Sec-MS-GEC: 5-мин окно (сек) в 100нс тиках + токен */
const gec = secMsgGecValue(1727100000000);
ok(/^\d+\d+[A-Z0-9]+$/.test(gec) && gec.includes('6A5AA1D4EAFF4E9FB37E23D68491D6F4'), 'secMsgGecValue: тики + токен');

ok(/^[A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT/.test(nowEdgeString(new Date())), 'nowEdgeString формат');

ok(ssmlEscape('Привет <world> & "x"') === 'Привет &lt;world&gt; &amp; &quot;x&quot;', 'ssmlEscape');

const w = uuid();
ok(typeof w === 'string' && w.length >= 32, 'uuid');

/* кластеризация слов в пузыри */
const words = [
  { x: 10, y: 10, w: 40, h: 12, text: 'Привет' },
  { x: 60, y: 10, w: 40, h: 12, text: 'мир!' },
  { x: 30, y: 400, w: 60, h: 12, text: 'Вторая' },
  { x: 100, y: 400, w: 60, h: 12, text: 'линия' },
];
const bubbles = clusterBubbleWords(words, 300, 500);
ok(bubbles.length === 2, 'clusterBubbleWords → 2 пузыря');
const sorted = sortBubblesReadingOrder(bubbles, {});
ok(sorted[0].y < sorted[1].y, 'sortBubblesReadingOrder сверху вниз');

/* тишина и нарезка */
const sr = 8000;
const segs = sliceSegments(trimSilence(new Float32Array(sr * 4).fill(0), sr).start > 0 ? [] : new Float32Array(sr * 4).fill(0), sr);
ok(Array.isArray(segs) && segs.length === 0, 'sliceSegments на пустом сигнале → 0 сегментов');

/* таймлайн */
const project = {
  settings: { gap: 350 },
  roles: [],
  pages: [
    { w: 800, h: 1200, bubbles: [] },
    { w: 800, h: 1200, bubbles: [
      { id: 'a', text: 'Привет мир', audio: null, roleId: '' },
      { id: 'b', text: 'Это вторая реплика — чуть длиннее', audio: null, roleId: '' },
    ] },
  ],
};
const tl = buildTimeline(project);
ok(tl.items.length === 3, 'buildTimeline: 1 idle + 2 реплики');
ok(tl.total > estimateSpeakDur('Привет мир'), 'total > длительности реплики');
ok(tl.items[1].t > tl.items[0].t && tl.items[2].t > tl.items[1].t, 'таймлайн упорядочен');

/* MP3 frame walker на реальном Edge-файле (если есть) */
const mp3Path = process.env.EDGE_MP3;
if (mp3Path && fs.existsSync(mp3Path)) {
  const bytes = new Uint8Array(fs.readFileSync(mp3Path));
  const out = cleanMp3Frames(bytes);
  ok(out.length > 0, 'cleanMp3Frames: produced output');
  ok(out[0] === 0xff && (out[1] & 0xe0) === 0xe0, 'output starts with valid sync');
  console.log('cleanMp3Frames: in', bytes.length, 'out', out.length, 'ratio', (out.length/bytes.length).toFixed(3));
} else {
  console.log('skip cleanMp3Frames real file (нет EDGE_MP3)');
}

/* синтетический round-trip V2 (Edge реальный: 48kbps/24kHz V2 L3) */
const frames = (() => {
  const arr = [];
  for (let k = 0; k < 50; k++) {
    arr.push(0xff, 0xf2, 0x64, 0x00);
    for (let i = 0; i < 140; i++) arr.push((k * 7 + i) & 0xff);
  }
  return new Uint8Array(arr);
})();
const clean = cleanMp3Frames(frames);
ok(clean.length === frames.length, 'cleanMp3Frames V2 roundtrip lossless');

ok(estimatePauseMs('Привет!?') > estimatePauseMs('Привет'), 'estimatePauseMs с пунктуацией длиннее');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);