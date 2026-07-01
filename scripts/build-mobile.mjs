import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const apiPath = path.resolve(process.cwd(), 'app/api');
const backupPath = path.resolve(process.cwd(), 'app_api_backup');

console.log('Temporarily moving app/api to avoid static export errors...');

if (fs.existsSync(apiPath)) {
  fs.renameSync(apiPath, backupPath);
}

try {
  execSync('npx cross-env NEXT_BUILD_TARGET=mobile next build', { stdio: 'inherit' });
} catch (error) {
  console.error('Mobile build failed:', error.message);
  process.exitCode = 1;
} finally {
  if (fs.existsSync(backupPath)) {
    console.log('Restoring app/api...');
    fs.renameSync(backupPath, apiPath);
  }
}
