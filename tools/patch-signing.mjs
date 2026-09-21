/* Настраивает release-подпись в regenerated Capacitor-проекте (android/).
 * Вызывается после `npx cap add android` / `npx cap sync android`.
 * Keystore и пароли берутся из android/keystore.properties (НЕ коммитится).
 * Формат keystore.properties:
 *   STORE_FILE=../keystore/voicecomic-release.jks
 *   STORE_PASSWORD=...
 *   KEY_ALIAS=voicecomic
 *   KEY_PASSWORD=...
 * Если файла нет — release собирается без подписи (fallback). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const gradle = 'android/app/build.gradle';
const props = 'android/keystore.properties';

if (!existsSync(gradle)) {
  console.error('нет ' + gradle);
  process.exit(0);
}

let g = readFileSync(gradle, 'utf8');

if (!/(versionName|versionCode)/.test(g)) {
  g = g.replace(
    'targetSdkVersion rootProject.ext.targetSdkVersion',
    'targetSdkVersion rootProject.ext.targetSdkVersion\n        versionCode 1\n        versionName "1.0.0"'
  );
} else {
  g = g.replace(/versionName\s+"[^"]*"/, 'versionName "1.0.0"');
  g = g.replace(/versionCode\s+\d+/, 'versionCode 1');
}

if (!g.includes('signingConfigs')) {
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
  console.log('release signing patched');
} else {
  console.log('release signing already present');
}