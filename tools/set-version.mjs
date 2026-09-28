// Ставит версию приложения в gradle.properties и считает versionCode
// по той же формуле, что и старая Capacitor-сборка:
// major*10000 + minor*100 + patch. Старые сборки держали versionCode=1,
// из-за чего Android не давал поставить новую версию поверх старой.
//
// Тело файла было случайно удалено в e4dbaab («починка» сводилась к замене
// «#» на «//», чтобы Node не спотыкался о shebang-строку в ESM), и с тех пор
// команда молча ничего не делала: workflow_dispatch с версией собирал релиз
// со старой версией и пытался пересоздать уже существующий тег.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node tools/set-version.mjs 2.1.0');
  process.exit(1);
}
const m = version.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) {
  console.error('версия должна быть вида 2.1.0');
  process.exit(1);
}
const [, major, minor, patch] = m;
const code = Number(major) * 10000 + Number(minor) * 100 + Number(patch);

const file = new URL('../gradle.properties', import.meta.url);
let text = readFileSync(file, 'utf8');
if (!/^voicecomic\.versionName=/m.test(text) || !/^voicecomic\.versionCode=/m.test(text)) {
  console.error('в gradle.properties нет voicecomic.versionName/versionCode');
  process.exit(1);
}
text = text.replace(/^voicecomic\.versionName=.*$/m, `voicecomic.versionName=${version}`);
text = text.replace(/^voicecomic\.versionCode=.*$/m, `voicecomic.versionCode=${code}`);
writeFileSync(file, text);
console.log(`versionName=${version} versionCode=${code}`);
