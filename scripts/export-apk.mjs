import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(new URL(import.meta.url).pathname.replace(/^\//, '').replace(/\/scripts\/export-apk\.mjs$/, ''));
const outDir = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
const srcApk = path.join(outDir, 'app-debug.apk');

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = packageJson.version;

async function main() {
  if (!fs.existsSync(srcApk)) {
    console.error('Source APK not found at', srcApk);
    process.exit(1);
  }

  // The user requested: version(value)_A-CAMP.apk
  const destName = `${version}_A-CAMP.apk`;
  const destPath = path.join(repoRoot, destName); // Saving to root folder instead of deeply nested outDir

  fs.copyFileSync(srcApk, destPath);
  console.log('Exported APK ->', destPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
