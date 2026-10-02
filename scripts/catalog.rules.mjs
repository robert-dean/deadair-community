/**
 * What makes an entry acceptable, and what the published catalogue looks like. Pure: the builder reads
 * the files and writes the output, and everything it decides in between is here, so the tests can
 * reach all of it without a disk.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CATALOG_FORMAT = 'deadair.catalog/1';

/** The persona file format the station's Import reads. `PERSONA_FILE_FORMAT` in apps/api/src/modules/personas/persona.file.ts. */
export const PERSONA_FILE_FORMAT = 'deadair.persona/1';

/** The console language pack format the station's import reads. `LANGUAGE_PACK_FORMAT` in apps/web/src/i18n/language.pack.ts. */
export const LANGUAGE_PACK_FORMAT = 'deadair.console-language';

/** The newest pack version a station reads. `LANGUAGE_PACK_VERSION` in apps/api/src/modules/languages/console.language.pack.ts. */
export const LANGUAGE_PACK_VERSION = 1;

/**
 * How big a pack's catalog may be: `CATALOG_LIMITS` in apps/api/src/modules/languages/console.language.pack.ts,
 * which the station refuses a pack over. Keep the two in step.
 */
export const CATALOG_LIMITS = { bytes: 2_000_000, strings: 20_000, depth: 8, stringLength: 10_000 };

/** The five kinds of entry, each the name of its directory. */
export const KINDS = ['stations', 'plugins', 'apps', 'personas', 'languages'];

/** A slug, which is also the file's name. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;

/**
 * Persona keys that every station already holds.
 *
 * The station ships these characters (apps/api/src/modules/personas/persona.defaults.ts and
 * caller.defaults.ts) and Import merges by key, so an entry using one of them would plan an UPDATE on
 * every station that took it and overwrite whatever that operator had changed about their own copy.
 * Keep this in step with those two files when the station gains a character.
 */
export const RESERVED_PERSONA_KEYS = ['classic', 'latenight', 'countdown', 'wisecrack', 'shockjock', 'conspiracy', 'videoage', 'slacker', 'millennium', 'skeptic', 'pedant'];

const schemaFor = { stations: 'station', plugins: 'plugin', apps: 'app', personas: 'persona', languages: 'language' };

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const readSchema = name => JSON.parse(readFileSync(join(schemasDir, `${name}.schema.json`), 'utf8'));

/** A name only a home or private network answers to: a single label, or one of the suffixes set aside for one. */
const PRIVATE_NAME = /^[^.]+$|\.(?:local|localhost|lan|home|internal|intranet|corp|home\.arpa)$/;

/** Whether a dotted IPv4 address is loopback, link-local, carrier-grade NAT or one of the ranges a router hands out. */
const privateIPv4 = host => {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** The same for IPv6: loopback, unique-local and link-local. */
const privateIPv6 = host => host === '::1' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);

let stationUrlPattern;

/**
 * What is wrong with a station's address, as a sentence the person who typed it can act on, or
 * `undefined` when there is nothing. The schema's pattern says the same about shape, but a submitter
 * shown the pattern pasted the pattern back as their address; this is what they are shown instead.
 *
 * It also refuses what the pattern cannot see: an address on a home network, which the directory's
 * probe and every listener would fail to reach however well it is written.
 *
 * @param {string} url
 * @returns {string | undefined}
 */
export function stationAddressProblem(url) {
    stationUrlPattern ??= new RegExp(readSchema('station').properties.url.pattern);
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        parsed = undefined;
    }
    // The network first: an address that only works at home stays unlistable whatever its scheme, and
    // asking for https before saying so costs the submitter an edit that cannot help.
    const host = parsed?.hostname;
    if (host !== undefined && /^https?:$/.test(parsed.protocol)) {
        const bare = host.replace(/^\[|\]$/g, '');
        const isPrivate = /^\d+\.\d+\.\d+\.\d+$/.test(bare) ? privateIPv4(bare) : bare.includes(':') ? privateIPv6(bare) : PRIVATE_NAME.test(bare.toLowerCase());
        if (isPrivate) {
            return `${host} is an address on a home or private network, so nobody outside that network can reach it. The directory needs the station's public address; one that only works at home cannot be listed`;
        }
    }
    if (/^http:\/\//i.test(url)) return 'it has to start with https://, because the directory and the apps reach a station over https only';
    if (host === undefined || !stationUrlPattern.test(url)) {
        return 'it has to be the web address the station is served from, such as https://radio.example.org, with nothing after the path';
    }
    return undefined;
}

/** Compiled once: one validator per kind, sharing the provenance, persona-file and language-pack schemas they reference. */
function compileValidators() {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    ajv.addSchema(readSchema('listing'));
    ajv.addSchema(readSchema('persona.file'));
    ajv.addSchema(readSchema('language.pack'));
    return Object.fromEntries(KINDS.map(kind => [kind, ajv.compile(readSchema(schemaFor[kind]))]));
}

let validators;

/**
 * @typedef {{ kind: string, slug: string, path: string, data?: unknown, readError?: string }} Entry
 * @typedef {{ path: string, message: string }} Problem
 */

/**
 * Every problem with every entry. Empty means the catalogue can be built.
 *
 * @param {Entry[]} entries
 * @returns {Problem[]}
 */
export function checkEntries(entries) {
    validators ??= compileValidators();
    const problems = [];
    const add = (path, message) => problems.push({ path, message });

    for (const entry of entries) {
        if (!KINDS.includes(entry.kind)) {
            add(entry.path, `is not in one of ${KINDS.join(', ')}`);
            continue;
        }
        if (!SLUG_PATTERN.test(entry.slug)) {
            add(entry.path, `the name "${entry.slug}" is not a slug: lowercase letters, digits and hyphens, starting with a letter or digit, at most 49`);
        }
        if (entry.readError !== undefined) {
            add(entry.path, entry.readError);
            continue;
        }

        const validate = validators[entry.kind];
        if (!validate(entry.data)) {
            for (const error of validate.errors ?? []) add(entry.path, `${error.instancePath || '(root)'} ${error.message}`);
            continue;
        }

        for (const message of ruleProblems(entry)) add(entry.path, message);
    }

    for (const message of duplicateProblems(entries)) problems.push(message);
    return problems;
}

/** What a schema cannot say about one entry on its own. */
function ruleProblems({ kind, slug, data }) {
    const problems = [];
    const { listing } = data;
    if (listing.dateModified !== undefined && listing.dateModified < listing.dateAdded) {
        problems.push('listing.dateModified is before listing.dateAdded');
    }

    if (kind === 'stations') {
        const problem = stationAddressProblem(data.url);
        if (problem !== undefined) problems.push(`url: ${problem}`);
    }

    if (kind === 'plugins' && data.id.startsWith('deadair.')) {
        problems.push(`id "${data.id}" is under deadair., which belongs to the plugins the station ships; the console refuses to import one`);
    }

    if (kind === 'personas') {
        const { file } = data;
        if (file.format !== PERSONA_FILE_FORMAT) problems.push(`file.format is "${file.format}", and the station's Import reads "${PERSONA_FILE_FORMAT}"`);
        if (file.personas.length !== 1) {
            problems.push(`file holds ${file.personas.length} characters; an entry is one, so each can be taken on its own`);
        } else {
            const { key } = file.personas[0];
            if (RESERVED_PERSONA_KEYS.includes(key)) {
                problems.push(`key "${key}" is a character every station already has, so importing this would overwrite that station's own copy; choose another key`);
            } else if (key !== slug) {
                problems.push(`key "${key}" must match the file's name "${slug}", which is what keeps two entries from importing over each other`);
            }
        }
    }
    if (kind === 'languages') problems.push(...languageProblems(slug, data.file));
    return problems;
}

/** A language tag in its canonical form (`pt-br` is `pt-BR`), or `undefined` for text that is not one. */
export function canonicalLocale(tag) {
    try {
        return Intl.getCanonicalLocales(tag)[0];
    } catch {
        return undefined;
    }
}

/** Every string in a catalog, and the first thing that makes it not a catalog. */
function catalogShape(catalog) {
    let strings = 0;
    let fault;
    const walk = (node, path, depth) => {
        if (fault !== undefined) return;
        if (depth > CATALOG_LIMITS.depth) {
            fault = `"${path}" nests deeper than ${CATALOG_LIMITS.depth} levels`;
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            const at = path === '' ? key : `${path}.${key}`;
            if (typeof value === 'string') {
                strings += 1;
                if (value.length > CATALOG_LIMITS.stringLength) fault ??= `"${at}" is longer than ${CATALOG_LIMITS.stringLength} characters`;
            } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                walk(value, at, depth + 1);
            } else {
                fault ??= `"${at}" is neither text nor a group of strings`;
            }
        }
    };
    walk(catalog, '', 1);
    return { strings, fault };
}

/**
 * What the station would refuse about a pack beyond its schema: the same checks its import makes
 * (`ConsoleLanguagesService.import`), so an entry here is one a station can install. Whether each
 * string fits the English is the console's to say when it loads the pack, and it is not judged here.
 */
function languageProblems(slug, file) {
    const problems = [];
    if (file.version > LANGUAGE_PACK_VERSION) problems.push(`file.version is ${file.version}, and a station reads packs up to version ${LANGUAGE_PACK_VERSION}`);

    const locale = canonicalLocale(file.locale);
    if (locale === undefined) {
        problems.push(`file.locale "${file.locale}" is not a language tag, such as de or pt-BR`);
    } else if (new Intl.Locale(locale).language === 'en') {
        problems.push('file.locale is English, which is built into the console and is what every other language falls back to');
    } else if (slug !== locale.toLowerCase()) {
        problems.push(`the file must be named after its language: languages/${locale.toLowerCase()}.json for "${locale}"`);
    }

    if (JSON.stringify(file.catalog).length > CATALOG_LIMITS.bytes) problems.push(`file.catalog is larger than ${CATALOG_LIMITS.bytes} bytes`);
    const { strings, fault } = catalogShape(file.catalog);
    if (fault !== undefined) problems.push(`file.catalog: ${fault}`);
    else if (strings === 0) problems.push('file.catalog holds no strings');
    if (strings > CATALOG_LIMITS.strings) problems.push(`file.catalog holds more than ${CATALOG_LIMITS.strings} strings`);
    return problems;
}

/** Two entries that would be the same thing on a station, or the same card in the directory. */
function duplicateProblems(entries) {
    const problems = [];
    const seen = new Map();
    const claim = (kind, value, entry, what) => {
        const key = `${kind} ${value}`;
        const first = seen.get(key);
        if (first === undefined) seen.set(key, entry.path);
        else problems.push({ path: entry.path, message: `${what} is already listed by ${first}` });
    };

    for (const entry of entries) {
        if (entry.data === undefined || typeof entry.data !== 'object' || entry.data === null) continue;
        if (entry.kind === 'plugins' && typeof entry.data.id === 'string') claim('plugins', entry.data.id, entry, `plugin id "${entry.data.id}"`);
        if (entry.kind === 'stations' && typeof entry.data.url === 'string') {
            claim('stations', entry.data.url.toLowerCase(), entry, `station address ${entry.data.url}`);
        }
    }
    return problems;
}

/** An entry as published: its slug beside its own fields, and never the editor hint. */
const published = (slug, data) => {
    const { $schema: _, ...rest } = data;
    return { slug, ...rest };
};

const bySlug = (a, b) => a.slug.localeCompare(b.slug);

/**
 * The catalogue and the files published beside it, from entries that have already passed
 * {@link checkEntries}.
 *
 * A persona's file is published on its own at `download`, a path relative to catalog.json, so that
 * what somebody saves is byte for byte what the console's Import takes. The catalogue carries the
 * character too, so a card can show it without a second request. A language pack is published the
 * same way, and the catalogue carries only its header and its count of strings.
 *
 * @param {Entry[]} entries
 * @param {{ builtAt: string }} options
 * @returns {{ catalog: object, files: Record<string, object> }}
 */
export function assembleCatalog(entries, { builtAt }) {
    const of = kind => entries.filter(entry => entry.kind === kind).sort(bySlug);
    const files = {};

    const personas = of('personas').map(({ slug, data }) => {
        const download = `personas/${slug}.json`;
        files[download] = data.file;
        return { slug, summary: data.summary, author: data.author, listing: data.listing, download, persona: data.file.personas[0] };
    });

    // A language's pack is published on its own for the same reason a persona's file is. The catalogue
    // carries its header and how many strings it has, and never the strings: a pack is a couple of
    // hundred kilobytes, and a card needs none of it.
    const languages = of('languages').map(({ slug, data }) => {
        const download = `languages/${slug}.json`;
        files[download] = data.file;
        const { locale, name, direction, madeFor } = data.file;
        const entry = { slug, locale, name, direction, madeFor, strings: catalogShape(data.file.catalog).strings, translators: data.translators };
        if (data.summary !== undefined) entry.summary = data.summary;
        return { ...entry, listing: data.listing, download };
    });

    const catalog = {
        format: CATALOG_FORMAT,
        builtAt,
        stations: of('stations').map(({ slug, data }) => published(slug, data)),
        plugins: of('plugins').map(({ slug, data }) => published(slug, data)),
        apps: of('apps').map(({ slug, data }) => published(slug, data)),
        personas,
        languages,
    };
    return { catalog, files };
}
