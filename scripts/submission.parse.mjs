/**
 * Turning a submitted issue form into an entry. Pure: the workflow reads the issue and writes the
 * file, and every decision in between is here.
 *
 * GitHub renders an issue form's answers as Markdown, one `### <label>` heading per field, which is
 * what this reads. **The labels below are the contract with the forms** in .github/ISSUE_TEMPLATE, and
 * a test reads those forms to prove every label here is one of theirs.
 *
 * Everything in an issue is untrusted text from anybody with a GitHub account. It is only ever parsed
 * here as data, then checked by the same rules as a hand-written entry; the workflow never puts it
 * into a shell.
 */
import { SLUG_PATTERN } from './catalog.rules.mjs';

/** The label that marks an issue as a submission, and which kind it is. */
export const SUBMISSION_LABELS = { 'add-station': 'stations', 'add-plugin': 'plugins', 'add-persona': 'personas', 'add-app': 'apps' };

/** Field labels, per kind, exactly as the forms word them. */
export const FIELDS = {
    stations: {
        name: 'Station name',
        url: 'Address',
        location: 'Where it broadcasts from',
        genres: 'What it plays',
        language: 'Language',
        description: 'About the station',
    },
    plugins: {
        id: 'Plugin id',
        name: 'Name',
        description: 'What it does',
        author: 'Author',
        repository: 'Source repository',
        license: 'Licence',
        version: 'Version',
        apiVersion: 'API version range',
        capabilities: 'Capabilities',
        hosts: 'Hosts it talks to',
        hostsFromConfig: 'Operator-configured address',
        tarball: 'Tarball URL',
    },
    personas: {
        summary: 'One line for the card',
        author: 'Author',
        file: 'Exported file',
    },
    apps: {
        name: 'Name',
        kind: 'Kind',
        platforms: 'Platforms',
        description: 'What it does',
        author: 'Author',
        url: 'Where to get it',
        repository: 'Source repository',
        license: 'Licence',
    },
};

/** What GitHub writes for an optional field left empty. */
const NO_RESPONSE = '_No response_';

/**
 * Every `### label` section of a rendered form, label to raw text. A field left empty is absent.
 *
 * @param {string} body
 * @returns {Map<string, string>}
 */
export function readForm(body) {
    const fields = new Map();
    const sections = `\n${body.replace(/\r\n/g, '\n')}`.split(/\n### /).slice(1);
    for (const section of sections) {
        const newline = section.indexOf('\n');
        const label = (newline === -1 ? section : section.slice(0, newline)).trim();
        const value = newline === -1 ? '' : section.slice(newline + 1).trim();
        if (value !== '' && value !== NO_RESPONSE) fields.set(label, value);
    }
    return fields;
}

/** A fenced block's contents, or the text as it stands when it is not fenced. */
const unfence = value => value.match(/^```[a-z]*\n([\s\S]*?)\n```$/)?.[1] ?? value;

/** The options ticked in a checkboxes field. */
const ticked = value =>
    value
        .split('\n')
        .map(line => line.match(/^- \[[xX]\] (.+)$/)?.[1]?.trim())
        .filter(option => option !== undefined);

/** One item per line or per comma, trimmed, empties dropped. */
const list = value =>
    value
        .split(/[\n,]/)
        .map(item => item.trim())
        .filter(item => item !== '');

/** A slug made from a name: what the file will be called. */
export const slugify = name =>
    name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 49)
        .replace(/-+$/, '');

/**
 * The entry a submission describes, or the reasons there is not one.
 *
 * Only shapes the fields; whether the entry is ACCEPTABLE is `checkEntries`'s question, asked of the
 * result exactly as it is asked of a hand-written file. `listing` is stamped here: the submitter is
 * the issue's author, and `dateAdded` survives an edit of an entry that already exists.
 *
 * @param {string} kind
 * @param {Map<string, string>} form
 * @param {{ login: string, today: string, existing?: (slug: string) => { listing?: { submittedBy?: string, dateAdded?: string } } | undefined }} context
 *   `existing` answers the entry already at a slug, if there is one.
 * @returns {{ slug: string, data: object } | { problems: string[] }}
 */
export function toEntry(kind, form, { login, today, existing }) {
    const labels = FIELDS[kind];
    const get = field => form.get(labels[field]);
    const problems = [];
    const need = field => {
        const value = get(field);
        if (value === undefined) problems.push(`"${labels[field]}" is required`);
        return value;
    };

    let slug;
    let data;

    if (kind === 'stations') {
        const name = need('name');
        data = { name, url: need('url')?.replace(/\/+$/, ''), description: need('description') };
        if (get('location') !== undefined) data.location = get('location');
        if (get('genres') !== undefined) data.genres = list(get('genres'));
        if (get('language') !== undefined) data.language = get('language');
        slug = name === undefined ? undefined : slugify(name);
    } else if (kind === 'plugins') {
        const name = need('name');
        data = {
            id: need('id'),
            name,
            description: need('description'),
            author: need('author'),
            repository: need('repository'),
            license: need('license'),
            version: need('version'),
            apiVersion: need('apiVersion'),
            capabilities: ticked(get('capabilities') ?? ''),
            hosts: list(get('hosts') ?? ''),
        };
        if (ticked(get('hostsFromConfig') ?? '').length > 0) data.hostsFromConfig = true;
        slug = name === undefined ? undefined : slugify(name);
    } else if (kind === 'apps') {
        const name = need('name');
        data = {
            name,
            kind: need('kind'),
            platforms: ticked(get('platforms') ?? ''),
            description: need('description'),
            author: need('author'),
            url: need('url'),
        };
        if (get('repository') !== undefined) data.repository = get('repository');
        if (get('license') !== undefined) data.license = get('license');
        slug = name === undefined ? undefined : slugify(name);
    } else if (kind === 'personas') {
        const raw = need('file');
        data = { summary: need('summary'), author: need('author') };
        if (raw !== undefined) {
            try {
                data.file = JSON.parse(unfence(raw));
            } catch (error) {
                problems.push(`"${labels.file}" is not the JSON the console exported: ${error.message}`);
            }
        }
        // The key is the slug, because the key is what an import merges on. A file holding more than
        // one character is refused by the rules; here it only has no single key to name the entry by.
        const characters = data.file?.personas;
        if (Array.isArray(characters) && characters.length === 1 && typeof characters[0]?.key === 'string') slug = characters[0].key;
        else if (data.file !== undefined) problems.push('the exported file must hold exactly one character: export that one alone from its own page in the console');
    } else {
        return { problems: [`unknown kind "${kind}"`] };
    }

    if (problems.length > 0) return { problems };
    if (slug === undefined || !SLUG_PATTERN.test(slug)) {
        return { problems: [`no usable file name comes out of "${slug ?? ''}": it needs letters or digits`] };
    }

    const previous = existing?.(slug)?.listing;
    if (previous?.submittedBy !== undefined && previous.submittedBy.toLowerCase() !== login.toLowerCase()) {
        return { problems: [`${kind}/${slug}.json is already listed by @${previous.submittedBy}. Choose another name, or ask them to change theirs.`] };
    }
    data.listing = previous?.dateAdded === undefined ? { submittedBy: login, dateAdded: today } : { submittedBy: login, dateAdded: previous.dateAdded, dateModified: today };

    return { slug, data: withSchema(kind, data) };
}

/** The editor hint first, so a file opened by hand is checked as it is edited. */
const withSchema = (kind, data) => ({ $schema: `../schemas/${kind.replace(/s$/, '')}.schema.json`, ...data });
