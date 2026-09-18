/**
 * Reading the entries off disk, shared by the builder and the submission workflow so both judge the
 * same files the same way.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from './catalog.rules.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every file under the four directories, read and parsed. A file that is not `<slug>.json` is an
 * entry that fails rather than one that is skipped, so a stray file is noticed.
 *
 * @returns {import('./catalog.rules.mjs').Entry[]}
 */
export function readEntries() {
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
