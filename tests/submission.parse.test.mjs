import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { root } from '../scripts/catalog.files.mjs';
import { checkEntries } from '../scripts/catalog.rules.mjs';
import { FIELDS, languageTag, readForm, slugify, SUBMISSION_LABELS, toEntry } from '../scripts/submission.parse.mjs';

/** A form's body as GitHub renders it: a heading per field, `_No response_` for an empty optional one. */
const render = fields =>
    Object.entries(fields)
        .map(([label, value]) => `### ${label}\n\n${value ?? '_No response_'}`)
        .join('\n\n');

const context = { login: 'someone', today: '2026-09-18' };

describe('the forms and the parser agree', () => {
    const forms = { stations: 'add-station', plugins: 'add-plugin', personas: 'add-persona', apps: 'add-app', languages: 'add-language' };

    for (const [kind, name] of Object.entries(forms)) {
        it(`every ${kind} label is one ${name}.yml renders, and the form sets its label`, () => {
            const yaml = readFileSync(join(root, '.github/ISSUE_TEMPLATE', `${name}.yml`), 'utf8');
            const labels = [...yaml.matchAll(/^ {10}label: (.+)$/gm)].map(match => match[1].trim());
            for (const label of Object.values(FIELDS[kind])) assert.ok(labels.includes(label), `${name}.yml has no field labelled "${label}"`);
            assert.match(yaml, new RegExp(`^labels: \\[${name}\\]$`, 'm'));
            assert.equal(SUBMISSION_LABELS[name], kind);
        });
    }
});

describe('readForm', () => {
    it('reads each heading to its value, and leaves out a field left empty', () => {
        const form = readForm(render({ 'Station name': 'Night Shift', 'Where it broadcasts from': undefined, 'About the station': 'All night.\n\nEvery night.' }));
        assert.deepEqual([...form], [
            ['Station name', 'Night Shift'],
            ['About the station', 'All night.\n\nEvery night.'],
        ]);
    });

    it('reads Windows line endings', () => {
        assert.equal(readForm('### Name\r\n\r\nPanel\r\n').get('Name'), 'Panel');
    });
});

describe('slugify', () => {
    it('makes a file name out of a name', () => {
        assert.equal(slugify('Radio Café — Late!'), 'radio-cafe-late');
        assert.equal(slugify('   '), '');
        assert.equal(slugify('x'.repeat(80)).length, 49);
    });
});

describe('languageTag', () => {
    it('turns a language named in English or in itself into its tag', () => {
        assert.equal(languageTag('English'), 'en');
        assert.equal(languageTag(' french '), 'fr');
        assert.equal(languageTag('Deutsch'), 'de');
    });

    it('keeps a tag, putting its case right', () => {
        assert.equal(languageTag('en-GB'), 'en-GB');
        assert.equal(languageTag('EN-gb'), 'en-GB');
    });

    it('leaves anything else as written, for the rules to refuse', () => {
        assert.equal(languageTag('Klingon, mostly'), 'Klingon, mostly');
    });
});

describe('toEntry', () => {
    it('makes a station that passes the rules', () => {
        const form = readForm(
            render({
                'Station name': 'Night Shift',
                Address: 'https://radio.example.org/',
                'What it plays': 'jungle, dub\nambient',
                'About the station': 'All night.',
            }),
        );
        const result = toEntry('stations', form, context);

        assert.equal(result.slug, 'night-shift');
        assert.equal(result.data.url, 'https://radio.example.org');
        assert.deepEqual(result.data.genres, ['jungle', 'dub', 'ambient']);
        assert.deepEqual(result.data.listing, { submittedBy: 'someone', dateAdded: '2026-09-18' });
        assert.deepEqual(checkEntries([{ kind: 'stations', slug: result.slug, path: 'x', data: result.data }]), []);
    });

    it('takes a station\'s language by name', () => {
        const form = readForm(render({ 'Station name': 'Night Shift', Address: 'https://radio.example.org', Language: 'English', 'About the station': 'All night.' }));
        const result = toEntry('stations', form, context);

        assert.equal(result.data.language, 'en');
        assert.deepEqual(checkEntries([{ kind: 'stations', slug: result.slug, path: 'x', data: result.data }]), []);
    });

    it('makes a plugin from ticked boxes and a host per line', () => {
        const form = readForm(
            render({
                'Plugin id': 'org.example.bandcamp',
                Name: 'Bandcamp',
                'What it does': 'Records from Bandcamp.',
                Author: 'Someone',
                'Source repository': 'https://github.com/someone/bandcamp',
                Licence: 'MIT',
                Version: '1.2.0',
                'API version range': '^1.0.0',
                Capabilities: '- [X] catalog\n- [ ] stream\n- [x] enrichment',
                'Hosts it talks to': 'bandcamp.com\n*.bcbits.com',
                'Operator-configured address': '- [ ] It also talks to an address the operator types into its settings',
                'Tarball URL': undefined,
            }),
        );
        const result = toEntry('plugins', form, context);

        assert.deepEqual(result.data.capabilities, ['catalog', 'enrichment']);
        assert.deepEqual(result.data.hosts, ['bandcamp.com', '*.bcbits.com']);
        assert.equal('hostsFromConfig' in result.data, false);
        assert.deepEqual(checkEntries([{ kind: 'plugins', slug: result.slug, path: 'x', data: result.data }]), []);
    });

    it('takes a persona from a pasted export, and names it by its key', () => {
        const file = { format: 'deadair.persona/1', takenAt: '2026-09-18T00:00:00.000Z', personas: [{ key: 'the-archivist', label: 'The Archivist', style: 'a librarian', stories: [] }] };
        const form = readForm(render({ 'One line for the card': 'Liner notes.', Author: 'Someone', 'Exported file': `\`\`\`json\n${JSON.stringify(file, null, 2)}\n\`\`\`` }));
        const result = toEntry('personas', form, context);

        assert.equal(result.slug, 'the-archivist');
        assert.deepEqual(result.data.file, file);
        assert.deepEqual(checkEntries([{ kind: 'personas', slug: result.slug, path: 'x', data: result.data }]), []);
    });

    it('says what is wrong with a persona that is not one character', () => {
        const file = { format: 'deadair.persona/1', takenAt: 'x', personas: [] };
        const form = readForm(render({ 'One line for the card': 'x', Author: 'x', 'Exported file': JSON.stringify(file) }));
        assert.match(toEntry('personas', form, context).problems[0], /exactly one character/);

        const broken = readForm(render({ 'One line for the card': 'x', Author: 'x', 'Exported file': '{ not json' }));
        assert.match(toEntry('personas', broken, context).problems[0], /is not the JSON the console exported/);
    });

    it('names every required field that is missing', () => {
        const { problems } = toEntry('apps', readForm(render({ Name: 'Panel' })), context);
        assert.deepEqual(problems, ['"Kind" is required', '"What it does" is required', '"Author" is required', '"Where to get it" is required']);
    });

    it('refuses a name that makes no file name', () => {
        const form = readForm(render({ 'Station name': '!!!', Address: 'https://a.example', 'About the station': 'x' }));
        assert.match(toEntry('stations', form, context).problems[0], /no usable file name/);
    });

    it('will not overwrite somebody else’s entry', () => {
        const form = readForm(render({ 'Station name': 'Night Shift', Address: 'https://a.example', 'About the station': 'x' }));
        const existing = () => ({ listing: { submittedBy: 'SomebodyElse', dateAdded: '2026-01-01' } });
        assert.match(toEntry('stations', form, { ...context, existing }).problems[0], /already listed by @SomebodyElse/);
    });

    it('keeps the date an entry was added when its own submitter edits it', () => {
        const form = readForm(render({ 'Station name': 'Night Shift', Address: 'https://a.example', 'About the station': 'x' }));
        const existing = () => ({ listing: { submittedBy: 'SOMEONE', dateAdded: '2026-01-01' } });
        assert.deepEqual(toEntry('stations', form, { ...context, existing }).data.listing, {
            submittedBy: 'someone',
            dateAdded: '2026-01-01',
            dateModified: '2026-09-18',
        });
    });

    describe('a language', () => {
        const pack = {
            format: 'deadair.console-language',
            version: 1,
            locale: 'pt-br',
            name: 'Português',
            direction: 'ltr',
            madeFor: '0.35.0',
            catalog: { common: { action: { cancel: 'Cancelar' } } },
        };
        const form = readForm(render({ 'Where the file is': 'https://example.org/pt-BR.json', 'Translated by': 'Someone', 'One line for the card': 'Brazilian.' }));

        it('is named by the language the downloaded pack is in, and passes the rules', () => {
            const result = toEntry('languages', form, { ...context, file: pack });

            assert.equal(result.slug, 'pt-br');
            assert.equal(result.data.$schema, '../schemas/language.schema.json');
            assert.equal(result.data.summary, 'Brazilian.');
            assert.deepEqual(result.data.file, pack);
            assert.deepEqual(checkEntries([{ kind: 'languages', slug: result.slug, path: 'x', data: result.data }]), []);
        });

        it('says so when the file could not be read from the address', () => {
            assert.deepEqual(toEntry('languages', form, context).problems, ['the language pack could not be read from that address']);
        });

        it('says only that the address is missing when there is none', () => {
            const blank = readForm(render({ 'Where the file is': undefined, 'Translated by': 'Someone' }));
            assert.deepEqual(toEntry('languages', blank, context).problems, ['"Where the file is" is required']);
        });

        it('needs the pack to say which language it is in', () => {
            assert.deepEqual(toEntry('languages', form, { ...context, file: { ...pack, locale: 'not a tag!' } }).problems, [
                'the pack does not say which language it is in, as a language tag such as de or pt-BR',
            ]);
        });

        it('will not overwrite somebody else’s language', () => {
            const existing = () => ({ listing: { submittedBy: 'first', dateAdded: '2026-09-01' } });
            assert.match(toEntry('languages', form, { ...context, file: pack, existing }).problems[0], /already listed by @first/);
        });
    });
});
