#!/usr/bin/env node
/**
 * Asks every listed station what it is playing and writes dist/status.json. Run after the build,
 * which it reads the station list from.
 *
 *     PREVIOUS_STATUS_URL=https://…/status.json node scripts/stations.probe.mjs
 *
 * PREVIOUS_STATUS_URL is the status.json this run replaces. It is how a station's last answer is
 * remembered from one run to the next without committing anything; without it every run starts
 * fresh, which is right for a first publish and harmless otherwise.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quietStations, STATUS_FORMAT, stationStatus } from './stations.status.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const TIMEOUT_MS = 8_000;
/** A now-playing answer is a few hundred bytes. Anything far past that is not one. */
const MAX_BYTES = 64 * 1024;
const USER_AGENT = 'deadair-community-directory (+https://deadair.radio/community/stations)';

/** The body of a JSON answer, or undefined for anything else: a timeout, a refusal, an error status, too much, not JSON. */
async function fetchJson(url) {
    try {
        const response = await fetch(url, {
            headers: { accept: 'application/json', 'user-agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok || response.body === null) return undefined;

        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > MAX_BYTES) return undefined;
            chunks.push(chunk);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        return undefined;
    }
}

const catalog = JSON.parse(readFileSync(join(dist, 'catalog.json'), 'utf8'));
const previousUrl = process.env.PREVIOUS_STATUS_URL;
const previous = previousUrl ? await fetchJson(previousUrl) : undefined;
const previousStations = previous?.format === STATUS_FORMAT && typeof previous.stations === 'object' ? previous.stations : {};

const checkedAt = new Date().toISOString();
const results = await Promise.all(
    catalog.stations.map(async ({ slug, url }) => {
        const answer = await fetchJson(`${url}/api/nowplaying`);
        return [slug, stationStatus({ answer, checkedAt, previous: previousStations[slug] })];
    }),
);
const stations = Object.fromEntries(results);

writeFileSync(join(dist, 'status.json'), JSON.stringify({ format: STATUS_FORMAT, checkedAt, stations }, null, 2) + '\n');

const counts = results.reduce((tally, [, { state }]) => ({ ...tally, [state]: (tally[state] ?? 0) + 1 }), {});
const quiet = quietStations(stations, Object.fromEntries(catalog.stations.map(({ slug, listing }) => [slug, listing.dateAdded])), checkedAt);
const line = `${results.length} stations: ${Object.entries(counts)
    .map(([state, n]) => `${n} ${state}`)
    .join(', ')}`;
console.log(line);

if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [`### Stations`, '', line, ''];
    if (quiet.length > 0) {
        summary.push(`Not answering for 30 days or more, and worth asking their operators about: ${quiet.map(slug => `\`${slug}\``).join(', ')}.`, '');
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));
}
