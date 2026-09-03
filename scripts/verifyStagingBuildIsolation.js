import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST_DIR = resolve(process.cwd(), 'dist');
const STAGING_PROJECT_ID = 'artes-staging';
const PRODUCTION_PROJECT_ID = 'artes-media-app';

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(DIST_DIR);

let stagingReferences = 0;
const productionLeaks = [];
for (const path of files) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (content.includes(STAGING_PROJECT_ID)) stagingReferences += 1;
  if (content.includes(PRODUCTION_PROJECT_ID)) productionLeaks.push(path.replace(`${DIST_DIR}/`, ''));
}

if (stagingReferences === 0) {
  throw new Error('staging_project_id_missing_from_build');
}
if (productionLeaks.length > 0) {
  throw new Error(`production_project_id_found_in_staging_build:${productionLeaks.join(',')}`);
}

process.stdout.write(`${JSON.stringify({
  verified: true,
  stagingProjectId: STAGING_PROJECT_ID,
  productionProjectIdAbsent: true,
  filesWithStagingReference: stagingReferences,
  filesScanned: files.length,
}, null, 2)}\n`);
