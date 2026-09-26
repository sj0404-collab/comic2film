// Ставит версию приложения в gradle.properties и считает versionCode
// по той же формуле, что и старая Capacitor-сборка:
// major*10000 + minor*100 + patch. Старые сборки держали versionCode=1,
// из-за чего Android не давал поставить новую версию поверх старой.
import { readFileSync, writeFileSync } from 'node:fs';