#!/usr/bin/env node
/**
 * Reads every entry, checks it, and writes the site that serves the catalogue.
 *
 *     node scripts/catalog.build.mjs           check, then write dist/
 *     node scripts/catalog.build.mjs --check   check only, which is what a pull request runs
 *
 * dist/ holds catalog.json, each persona's file under personas/ and each language pack under languages/,
 * and the schemas, so an entry's
 * "$schema" resolves in an editor.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEntries, root } from './catalog.files.mjs';
import { assembleCatalog, checkEntries, KINDS } from './catalog.rules.mjs';

const dist = join(root, 'dist');
const checkOnly = process.argv.includes('--check');

const entries = readEntries();
const problems = checkEntries(entries);

if (problems.length > 0) {
    for (const { path, message } of problems) console.error(`${path}: ${message}`);
    console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    process.exit(1);
}

const counts = KINDS.map(kind => `${entries.filter(entry => entry.kind === kind).length} ${kind}`).join(', ');
if (checkOnly) {
    console.log(`ok: ${counts}`);
    process.exit(0);
}

const { catalog, files } = assembleCatalog(entries, { builtAt: new Date().toISOString() });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), JSON.stringify(body, null, 4) + '\n');
}
cpSync(join(root, 'schemas'), join(dist, 'schemas'), { recursive: true });
// Pages would otherwise run the output through Jekyll, which ignores nothing here but costs a build.
writeFileSync(join(dist, '.nojekyll'), '');

console.log(`wrote dist/: ${counts}`);
