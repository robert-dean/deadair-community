import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quietStations, readNowPlaying, stationStatus } from '../scripts/stations.status.mjs';

/** What a station on the air answers today, trimmed. */
const answer = {
    station: 'Deadair',
    onAir: true,
    listeners: 1,
    mounts: [{ format: 'mp3', path: '/live.mp3', bitrateKbps: 320 }],
    show: { name: 'Overnight', host: 'Chaz' },
    track: { kind: 'record', title: 'The Paradox', artist: 'Eradicator', album: 'The Paradox', startedAt: 1789737127346 },
};

describe('readNowPlaying', () => {
    it('keeps the name, the mounts, the show and the track, and nothing else', () => {
        assert.deepEqual(readNowPlaying(answer), {
            onAir: true,
            name: 'Deadair',
            mounts: [{ format: 'mp3', path: '/live.mp3' }],
            show: { name: 'Overnight', host: 'Chaz' },
            track: { kind: 'record', artist: 'Eradicator', title: 'The Paradox' },
        });
    });

    it('is not fooled by something that is not a now-playing answer', () => {
        assert.equal(readNowPlaying({ hello: 'world' }), undefined);
        assert.equal(readNowPlaying('<html>'), undefined);
        assert.equal(readNowPlaying(null), undefined);
    });

    it('drops a field of the wrong type rather than the whole answer', () => {
        assert.deepEqual(readNowPlaying({ onAir: false, station: 42, track: { kind: 'jingle', title: 'x' } }), { onAir: false });
    });

    it('keeps a mount only as a path on the station itself, in a format it knows', () => {
        const mounts = [
            { format: 'mp3', path: '/live.mp3' },
            { format: 'mp3', path: 'https://elsewhere.example/live.mp3' },
            { format: 'mp3', path: '//elsewhere.example/x' },
            { format: 'wav', path: '/live.wav' },
            { format: 'hls', path: '/live.m3u8' },
        ];
        assert.deepEqual(readNowPlaying({ onAir: true, mounts }).mounts, [
            { format: 'mp3', path: '/live.mp3' },
            { format: 'hls', path: '/live.m3u8' },
        ]);
    });

    it('cuts a field to length', () => {
        assert.equal(readNowPlaying({ onAir: true, station: 'x'.repeat(500) }).name.length, 80);
    });
});

describe('stationStatus', () => {
    it('is on air, and remembers when it last answered', () => {
        assert.deepEqual(stationStatus({ answer, checkedAt: 'T1' }), {
            state: 'on-air',
            checkedAt: 'T1',
            lastAnsweredAt: 'T1',
            name: 'Deadair',
            mounts: [{ format: 'mp3', path: '/live.mp3' }],
            show: { name: 'Overnight', host: 'Chaz' },
            track: { kind: 'record', artist: 'Eradicator', title: 'The Paradox' },
        });
    });

    it('is off the air when it answers and says so', () => {
        assert.equal(stationStatus({ answer: { onAir: false }, checkedAt: 'T1' }).state, 'off-air');
    });

    it('is unreachable when it does not answer, and carries the last answer forward', () => {
        assert.deepEqual(stationStatus({ checkedAt: 'T2', previous: { lastAnsweredAt: 'T1' } }), { state: 'unreachable', checkedAt: 'T2', lastAnsweredAt: 'T1' });
        assert.deepEqual(stationStatus({ checkedAt: 'T2' }), { state: 'unreachable', checkedAt: 'T2' });
    });
});

describe('quietStations', () => {
    const now = '2026-09-18T00:00:00.000Z';

    it('names a station unanswered for thirty days, and not one that answered recently', () => {
        const stations = {
            gone: { state: 'unreachable', lastAnsweredAt: '2026-08-01T00:00:00.000Z' },
            blip: { state: 'unreachable', lastAnsweredAt: '2026-09-17T00:00:00.000Z' },
            fine: { state: 'on-air', lastAnsweredAt: now },
        };
        assert.deepEqual(quietStations(stations, {}, now), ['gone']);
    });

    it('counts a station that has never answered from when it was listed', () => {
        const stations = { never: { state: 'unreachable' }, fresh: { state: 'unreachable' } };
        assert.deepEqual(quietStations(stations, { never: '2026-07-01', fresh: '2026-09-10' }, now), ['never']);
    });
});
