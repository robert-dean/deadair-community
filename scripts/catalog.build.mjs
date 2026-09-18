#!/usr/bin/env node
/**
 * Reads every entry, checks it, and writes the site that serves the catalogue.
 *
 *     node scripts/catalog.build.mjs           check, then write dist/
 *     node scripts/catalog.build.mjs --check   check only, which is what a pull request runs
 *
 * dist/ holds catalog.json, each persona's file under personas/, and the schemas, so an entry's
 * "$schema" resolves in an editor.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCatalog, checkEntries, KINDS } from './catalog.rules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const checkOnly = process.argv.includes('--check');

/** Every file under the four directories, read and parsed. A file that is not `<slug>.json` is an entry that fails. */
function readEntries() {
    const entries = [];
    for (const kind of KINDS) {
        const dir = join(root, kind);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir).sort()) {
            if (name.startsWith('.')) continue;
            const file = join(dir, name);
            const path = relative(root, file);
            const slug = basename(name, extname(name));
            if (statSync(file).isDirectory() || extname(name) !== '.json') {
                entries.push({ kind, slug, path, readError: 'an entry is one <slug>.json file' });
                continue;
            }
            try {
                entries.push({ kind, slug, path, data: JSON.parse(readFileSync(file, 'utf8')) });
            } catch (error) {
                entries.push({ kind, slug, path, readError: `is not JSON: ${error.message}` });
            }
        }
    }
    return entries;
}

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
