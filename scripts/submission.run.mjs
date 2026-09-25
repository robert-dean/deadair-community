#!/usr/bin/env node
/**
 * The submission workflow's one step that reads the issue. Writes the entry into the working tree,
 * checks the whole catalogue with it in place, and leaves the workflow three things:
 *
 * - outputs `ok`, `path` and `kind` in GITHUB_OUTPUT. `path` is built from a checked slug, never
 *   copied from the issue.
 * - $RUNNER_TEMP/submission.md, the comment or pull request body to post.
 *
 * The issue is read from the event payload on disk (GITHUB_EVENT_PATH) rather than from an expression
 * in the workflow, which is what keeps its text out of any shell.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEntries, root } from './catalog.files.mjs';
import { CATALOG_LIMITS, checkEntries } from './catalog.rules.mjs';
import { FIELDS, readForm, SUBMISSION_LABELS, toEntry } from './submission.parse.mjs';

const temp = process.env.RUNNER_TEMP ?? join(root, 'dist');
mkdirSync(temp, { recursive: true });

/** A tarball larger than the console's own import limit could never be installed anyway. `MAX_PLUGIN_ARCHIVE_BYTES` in apps/api. */
const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

function finish({ ok, path = '', kind = '', message }) {
    writeFileSync(join(temp, 'submission.md'), message);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\npath=${path}\nkind=${kind}\n`);
    console.log(message);
    process.exit(0);
}

const refused = problems =>
    [
        'This could not be turned into an entry yet:',
        '',
        ...problems.map(problem => `- ${problem}`),
        '',
        'Edit the issue to fix it, and this runs again.',
    ].join('\n');

/**
 * Downloads a plugin's tarball once, to take its checksum and read its package.json. The archive is
 * never unpacked to disk and nothing in it runs: tar prints one file to stdout.
 */
async function inspectTarball(url, version) {
    const problems = [];
    let bytes;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) return { problems: [`the tarball answered ${response.status}`] };
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_TARBALL_BYTES) return { problems: ['the tarball is larger than the 64 MB the console will import'] };
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_TARBALL_BYTES) return { problems: ['the tarball is larger than the 64 MB the console will import'] };
    } catch (error) {
        return { problems: [`the tarball could not be downloaded: ${error.message}`] };
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = join(temp, 'plugin.tgz');
    writeFileSync(file, bytes);
    let manifest;
    try {
        manifest = JSON.parse(execFileSync('tar', ['-xzOf', file, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
    } catch {
        return { problems: ['the tarball has no readable package/package.json, which is what npm pack writes and what the console reads'] };
    }
    if (typeof manifest?.deadair?.plugin !== 'string') problems.push('its package.json has no "deadair": { "plugin": … } entry, so the station would not find a plugin in it');
    if (manifest?.version !== version) problems.push(`its package.json says version ${manifest?.version}, and the form says ${version}`);
    return problems.length > 0 ? { problems } : { sha256 };
}

/**
 * A language pack is too big for an issue, so the form gives an address and this fetches the file
 * once, capped a little above the largest catalog a station stores. Parsed as data and nothing else;
 * the rules then judge it as they judge a pack added by hand.
 */
const MAX_PACK_BYTES = CATALOG_LIMITS.bytes + 64 * 1024;

async function downloadPack(url) {
    if (!/^https:\/\/\S+$/.test(url)) return { problems: ['the address must be https'] };
    let text;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) return { problems: [`the address answered ${response.status}`] };
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_PACK_BYTES) return { problems: ['the file is larger than 2 MB, which is more than a station stores'] };
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_PACK_BYTES) return { problems: ['the file is larger than 2 MB, which is more than a station stores'] };
        text = bytes.toString('utf8');
    } catch (error) {
        return { problems: [`the file could not be downloaded: ${error.message}`] };
    }
    try {
        return { file: JSON.parse(text) };
    } catch {
        return { problems: ['that address does not answer with JSON. Give the Raw link to the file itself, not a page showing it'] };
    }
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const { issue } = event;
const kinds = (issue.labels ?? []).map(label => SUBMISSION_LABELS[label.name]).filter(kind => kind !== undefined);
if (kinds.length !== 1) finish({ ok: false, message: refused(['an issue must carry exactly one of the add-… labels, which the form sets']) });

const [kind] = kinds;
const form = readForm(issue.body ?? '');
const existing = slug => {
    const file = join(root, kind, `${slug}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};
let file;
if (kind === 'languages') {
    const url = form.get(FIELDS.languages.url);
    if (url !== undefined) {
        const downloaded = await downloadPack(url.trim());
        if ('problems' in downloaded) finish({ ok: false, kind, message: refused(downloaded.problems) });
        file = downloaded.file;
    }
}
const result = toEntry(kind, form, { login: issue.user.login, today: new Date().toISOString().slice(0, 10), existing, file });
if ('problems' in result) finish({ ok: false, kind, message: refused(result.problems) });

const { slug, data } = result;
if (kind === 'plugins') {
    const tarball = form.get(FIELDS.plugins.tarball);
    if (tarball !== undefined) {
        if (!/^https:\/\/\S+\.tgz$/.test(tarball)) finish({ ok: false, kind, message: refused(['the tarball URL must be https and end in .tgz']) });
        const inspected = await inspectTarball(tarball, data.version);
        if ('problems' in inspected) finish({ ok: false, kind, message: refused(inspected.problems) });
        data.package = { tarball, sha256: inspected.sha256 };
    }
}

const path = `${kind}/${slug}.json`;
mkdirSync(join(root, kind), { recursive: true });
writeFileSync(join(root, path), JSON.stringify(data, null, 4) + '\n');

const problems = checkEntries(readEntries());
if (problems.length > 0) finish({ ok: false, kind, message: refused(problems.map(({ path: where, message }) => `\`${where}\`: ${message}`)) });

finish({
    ok: true,
    path,
    kind,
    message: [
        `Adds \`${path}\`, from #${issue.number} by @${issue.user.login}.`,
        '',
        'Every entry passed the same check a pull request runs. Checks do not start on their own for a pull request this workflow opens, so to run them again, close and reopen it.',
        '',
        `Closes #${issue.number}`,
    ].join('\n'),
});
