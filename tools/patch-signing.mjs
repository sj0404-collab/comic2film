/* Настраивает release-подпись в regenerated Capacitor-проекте (android/).
 * Вызывается после `npx cap add android` / `npx cap sync android`.
 * Keystore и пароли берутся из android/keystore.properties (НЕ коммитится).
 * Формат keystore.properties:
 *   STORE_FILE=../keystore/voicecomic-release.jks
 *   STORE_PASSWORD=...
 *   KEY_ALIAS=voicecomic
 *   KEY_PASSWORD=...
 * Если файла нет — release собирается без подписи (fallback).
 *
 * Версия берётся из package.json, а versionCode — из major*10000+minor*100+patch
 * плюс счётчик из existing-versionCode. Раньше здесь жёстко стояли
 * versionCode 1 и versionName "1.0.0": Android отказывается ставить новую
 * сборку поверх старой с тем же versionCode, то есть обновить установленный
 * APK было невозможно (а uninstall сносит проект в IndexedDB).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const gradle = 'android/app/build.gradle';
const props = 'android/keystore.properties';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function versionInfo() {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pkg.version || '0.0.0'));
  const [major, minor, patch] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  return { name: `${major}.${minor}.${patch}`, code: major * 10000 + minor * 100 + patch };
}

if (!existsSync(gradle)) {
  console.error('нет ' + gradle);
  process.exit(1); // раньше 0: в CI шаг проходил молча, и release собирался без подписи
}

let g = readFileSync(gradle, 'utf8');
const ver = versionInfo();

// Android не даст поставить APK поверх ранее установленного с не меньшим
// versionCode, поэтому монотонно поднимаем счётчик от того, что уже в файле.
const curCode = Number((/versionCode\s+(\d+)/.exec(g) || [])[1] || 0);
const code = curCode > 0 ? Math.max(curCode + 1, ver.code) : Math.max(1, ver.code);

if (!/versionName|versionCode/.test(g)) {
  g = g.replace(
    'targetSdkVersion rootProject.ext.targetSdkVersion',
    'targetSdkVersion rootProject.ext.targetSdkVersion\n        versionCode ' + code + '\n        versionName "' + ver.name + '"'
  );
} else {
  g = g.replace(/versionName\s+"[^"]*"/, 'versionName "' + ver.name + '"');
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code);
}

// Подпись. Проверяем именно release-конфиг: наличие блока signingConfigs
// само по себе ничего не значит (в шаблоне Capacitor есть debug-подпись),
// и старый тест "!g.includes('signingConfigs)" молча пропускал патч, оставляя
// сборку без подписи.
const hasReleaseSigning = /signingConfigs\s*\{[\s\S]*?\brelease\s*\{/.test(g);

if (!hasReleaseSigning) {
  g += `
def keystoreProps = new Properties()
def keystorePropsFile = rootProject.file('keystore.properties')
if (keystorePropsFile.exists()) {
  keystoreProps.load(keystorePropsFile.newInputStream())
} else {
  keystoreProps.STORE_FILE   = System.getenv('KEYSTORE_FILE') ?: ''
  keystoreProps.STORE_PASSWORD = System.getenv('KEYSTORE_PASSWORD') ?: ''
  keystoreProps.KEY_ALIAS    = System.getenv('KEY_ALIAS') ?: ''
  keystoreProps.KEY_PASSWORD = System.getenv('KEY_PASSWORD') ?: ''
}
android {
  signingConfigs {
    release {
      if (keystoreProps.STORE_FILE?.trim()) {
        storeFile rootProject.file(keystoreProps.STORE_FILE)
        storePassword keystoreProps.STORE_PASSWORD
        keyAlias keystoreProps.KEY_ALIAS
        keyPassword keystoreProps.KEY_PASSWORD
      }
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
`;
  writeFileSync(gradle, g);
  console.log(`release signing patched · versionName ${ver.name} · versionCode ${code}`);
} else {
  writeFileSync(gradle, g);
  console.log(`release signing уже настроен · versionName ${ver.name} · versionCode ${code}`);
}