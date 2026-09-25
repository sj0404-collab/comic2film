/* Сборка www/ — единственная публикуемая папка (GitHub Pages и Capacitor).
 * Копируются только файлы приложения: backend/, relay/, tests/, tools/ и
 * package.json наружу не выходят. */
import { mkdirSync, cpSync, rmSync } from 'node:fs';

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'sw.js', 'icon.svg', 'css', 'js', 'manifest']) {
  cpSync(f, 'www/' + f, { recursive: true });
}
console.log('www/ собран');