import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(new URL(import.meta.url).pathname.replace(/^\//, '').replace(/\/scripts\/export-apk.mjs$/, ''));
const outDir = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
const srcApk = path.join(outDir, 'app-debug.apk');
const seqFile = path.join(repoRoot, '.apk_seq');

function readSeq() {
  try {
    const content = fs.readFileSync(seqFile, 'utf8').trim();
    const n = parseInt(content, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function writeSeq(n) {
  fs.writeFileSync(seqFile, String(n), 'utf8');
}

async function main() {
  if (!fs.existsSync(srcApk)) {
    console.error('Source APK not found at', srcApk);
    process.exit(1);
  }

  let seq = readSeq();
  const destName = `u${seq}_fox-kisem.apk`;
  const destPath = path.join(outDir, destName);

  // If file exists, increment until free
  while (fs.existsSync(destPath)) {
    seq++;
  }

  fs.copyFileSync(srcApk, destPath);
  console.log('Exported APK ->', destPath);
  // increment for next time
  writeSeq(seq + 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
