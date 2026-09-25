import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleCatalog, CATALOG_LIMITS, checkEntries, LANGUAGE_PACK_FORMAT, PERSONA_FILE_FORMAT } from '../scripts/catalog.rules.mjs';

const listing = { submittedBy: 'someone', dateAdded: '2026-09-18' };

const station = (slug = 'night-shift', data = {}) => ({
    kind: 'stations',
    slug,
    path: `stations/${slug}.json`,
    data: { name: 'Night Shift', url: 'https://radio.example.org', description: 'All night.', listing, ...data },
});

const plugin = (slug = 'bandcamp', data = {}) => ({
    kind: 'plugins',
    slug,
    path: `plugins/${slug}.json`,
    data: {
        id: 'org.example.bandcamp',
        name: 'Bandcamp',
        description: 'Records from Bandcamp.',
        author: 'Someone',
        repository: 'https://github.com/someone/bandcamp',
        license: 'MIT',
        version: '1.2.0',
        apiVersion: '^1.0.0',
        capabilities: ['catalog'],
        hosts: ['bandcamp.com', '*.bcbits.com'],
        listing,
        ...data,
    },
});

const app = (slug = 'wall-panel', data = {}) => ({
    kind: 'apps',
    slug,
    path: `apps/${slug}.json`,
    data: {
        name: 'Wall panel',
        kind: 'remote',
        platforms: ['web'],
        description: 'What is on air, on a tablet by the door.',
        author: 'Someone',
        url: 'https://example.org/panel',
        listing,
        ...data,
    },
});

const character = (key = 'the-archivist', extra = {}) => ({ key, label: 'The Archivist', style: 'a librarian who reads liner notes aloud', stories: [], ...extra });

const persona = (slug = 'the-archivist', { characters = [character(slug)], format = PERSONA_FILE_FORMAT, data = {} } = {}) => ({
    kind: 'personas',
    slug,
    path: `personas/${slug}.json`,
    data: {
        summary: 'Liner notes, read aloud, at length.',
        author: 'Someone',
        file: { format, takenAt: '2026-09-18T00:00:00.000Z', personas: characters },
        listing,
        ...data,
    },
});

const pack = (file = {}) => ({
    format: LANGUAGE_PACK_FORMAT,
    version: 1,
    locale: 'de',
    name: 'Deutsch',
    direction: 'ltr',
    madeFor: '0.35.0',
    catalog: { common: { action: { cancel: 'Abbrechen', dismiss: 'Schließen' } } },
    ...file,
});

const language = (slug = 'de', { file = {}, data = {} } = {}) => ({
    kind: 'languages',
    slug,
    path: `languages/${slug}.json`,
    data: { translators: 'Someone', file: pack(file), listing, ...data },
});

const messages = entries => checkEntries(entries).map(problem => `${problem.path}: ${problem.message}`);

describe('checkEntries', () => {
    it('accepts one good entry of each kind', () => {
        assert.deepEqual(messages([station(), plugin(), app(), persona()]), []);
    });

    it('refuses a file name that is not a slug', () => {
        const [problem] = messages([station('Night_Shift')]);
        assert.match(problem, /is not a slug/);
    });

    it('refuses a plugin id under deadair.', () => {
        const [problem] = messages([plugin('spotify-fork', { id: 'deadair.spotify' })]);
        assert.match(problem, /belongs to the plugins the station ships/);
    });

    it('refuses a persona file holding two characters', () => {
        const [problem] = messages([persona('the-archivist', { characters: [character('the-archivist'), character('the-understudy')] })]);
        assert.match(problem, /holds 2 characters/);
    });

    it('refuses a persona whose key every station already holds', () => {
        const [problem] = messages([persona('classic')]);
        assert.match(problem, /every station already has/);
    });

    it('refuses a persona whose key is not its file name', () => {
        const [problem] = messages([persona('the-archivist', { characters: [character('archivist')] })]);
        assert.match(problem, /must match the file's name/);
    });

    it('refuses a persona file in another format', () => {
        const [problem] = messages([persona('the-archivist', { format: 'deadair.persona/2' })]);
        assert.match(problem, /Import reads "deadair\.persona\/1"/);
    });

    it('refuses a field the station would refuse, since Import validates strictly', () => {
        const problems = messages([persona('the-archivist', { characters: [character('the-archivist', { id: 'a-row-id' })] })]);
        assert.ok(problems.some(problem => /must NOT have additional properties/.test(problem)));
    });

    it('refuses a plain http station address', () => {
        const problems = messages([station('night-shift', { url: 'http://radio.example.org' })]);
        assert.ok(problems.some(problem => /\/url must match pattern/.test(problem)));
    });

    it('refuses a capability the SDK does not have', () => {
        const problems = messages([plugin('bandcamp', { capabilities: ['telepathy'] })]);
        assert.ok(problems.some(problem => /\/capabilities\/0/.test(problem)));
    });

    it('refuses a modified date before the added one', () => {
        const [problem] = messages([station('night-shift', { listing: { ...listing, dateModified: '2026-01-01' } })]);
        assert.match(problem, /dateModified is before/);
    });

    it('refuses two plugins with one id, and two stations at one address', () => {
        const problems = messages([plugin('bandcamp'), plugin('bandcamp-too'), station('a'), station('b', { url: 'https://RADIO.example.org' })]);
        assert.equal(problems.length, 2);
        assert.match(problems[0], /^plugins\/bandcamp-too\.json: plugin id/);
        assert.match(problems[1], /^stations\/b\.json: station address/);
    });

    it('reports a file that could not be read without checking it further', () => {
        const problems = messages([{ kind: 'stations', slug: 'broken', path: 'stations/broken.json', readError: 'is not JSON: Unexpected token' }]);
        assert.deepEqual(problems, ['stations/broken.json: is not JSON: Unexpected token']);
    });
});

describe('assembleCatalog', () => {
    it('publishes each persona file on its own, exactly as the entry holds it', () => {
        const entry = persona();
        const { catalog, files } = assembleCatalog([entry], { builtAt: '2026-09-18T00:00:00.000Z' });

        assert.deepEqual(files, { 'personas/the-archivist.json': entry.data.file });
        assert.equal(catalog.personas[0].download, 'personas/the-archivist.json');
        assert.equal(catalog.personas[0].persona.key, 'the-archivist');
    });

    it('sorts by slug and leaves the editor hint out', () => {
        const { catalog } = assembleCatalog([station('zulu', { $schema: '../schemas/station.schema.json' }), station('alpha')], { builtAt: 'now' });

        assert.deepEqual(
            catalog.stations.map(entry => entry.slug),
            ['alpha', 'zulu'],
        );
        assert.equal('$schema' in catalog.stations[1], false);
    });
});

describe('language entries', () => {
    it('accept a pack named after its language', () => {
        assert.deepEqual(messages([language(), language('pt-br', { file: { locale: 'pt-BR', name: 'Português' } })]), []);
    });

    it('refuse a pack whose name is not its language', () => {
        assert.deepEqual(messages([language('german')]), ['languages/german.json: the file must be named after its language: languages/de.json for "de"']);
    });

    it('refuse English, which every console has built in', () => {
        assert.deepEqual(messages([language('en-gb', { file: { locale: 'en-GB' } })]), [
            'languages/en-gb.json: file.locale is English, which is built into the console and is what every other language falls back to',
        ]);
    });

    it('refuse a tag that is not one', () => {
        assert.match(messages([language('xx', { file: { locale: 'not a tag!' } })])[0], /is not a language tag/);
    });

    it('refuse a newer format than a station reads', () => {
        assert.match(messages([language('de', { file: { version: 2 } })])[0], /reads packs up to version 1/);
    });

    it('refuse a key the station would refuse, since its import validates strictly', () => {
        assert.match(messages([language('de', { file: { translatedWith: 'a tool' } })])[0], /must NOT have additional properties/);
    });

    it('refuse a catalog that is not text', () => {
        assert.deepEqual(messages([language('de', { file: { catalog: { common: { action: { cancel: 42 } } } } })]), [
            'languages/de.json: file.catalog: "common.action.cancel" is neither text nor a group of strings',
        ]);
    });

    it('refuse a string longer than the station stores', () => {
        assert.match(messages([language('de', { file: { catalog: { common: { long: 'x'.repeat(CATALOG_LIMITS.stringLength + 1) } } } })])[0], /is longer than/);
    });

    it('refuse an empty catalog', () => {
        assert.deepEqual(messages([language('de', { file: { catalog: {} } })]), ['languages/de.json: file.catalog holds no strings']);
    });
});

describe('assembleCatalog, languages', () => {
    it('publishes each pack on its own, and lists its header and how many strings it has, never the strings', () => {
        const entry = language('de', { data: { summary: 'Reviewed by two native speakers.' } });
        const { catalog, files } = assembleCatalog([entry], { builtAt: 'now' });

        assert.deepEqual(files, { 'languages/de.json': entry.data.file });
        assert.deepEqual(catalog.languages, [
            {
                slug: 'de',
                locale: 'de',
                name: 'Deutsch',
                direction: 'ltr',
                madeFor: '0.35.0',
                strings: 2,
                translators: 'Someone',
                summary: 'Reviewed by two native speakers.',
                listing,
                download: 'languages/de.json',
            },
        ]);
    });
});

