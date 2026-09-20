/* Сборка www/ для Capacitor: только файлы приложения, без node_modules. */
import { mkdirSync, cpSync, rmSync } from 'node:fs';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'sw.js', 'icon.svg', 'css', 'js', 'manifest']) {
  cpSync(f, 'www/' + f, { recursive: true });
}
console.log('www/ собран');