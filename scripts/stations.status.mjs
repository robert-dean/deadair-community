/**
 * What the directory says about each station, worked out from what it answered. Pure: the probe does
 * the fetching and hands each answer here.
 *
 * A station answers GET <url>/api/nowplaying without a sign-in. Only a handful of its fields are kept,
 * each checked and cut to length, because this is somebody else's server and the site renders what
 * comes back.
 */

export const STATUS_FORMAT = 'deadair.status/1';

/** How long a station can go unanswered before the run's summary names it for a maintainer. Never removed automatically. */
export const QUIET_DAYS = 30;

/** A same-origin path, as the station states its mounts. Never a URL, so a listing cannot point a listener somewhere else. */
const MOUNT_PATH = /^\/[A-Za-z0-9._-]{1,60}$/;
const MOUNT_FORMATS = ['mp3', 'aac', 'opus', 'flac', 'hls'];

const text = (value, max) => (typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined);

/**
 * One station's answer, reduced to what a card shows. `undefined` when the answer is not a station's
 * now-playing document at all, which the directory treats the same as no answer.
 *
 * @param {unknown} body
 */
export function readNowPlaying(body) {
    if (typeof body !== 'object' || body === null || typeof body.onAir !== 'boolean') return undefined;

    const status = { onAir: body.onAir };
    const name = text(body.station, 80);
    if (name !== undefined) status.name = name;

    if (typeof body.show === 'object' && body.show !== null) {
        const show = text(body.show.name, 120);
        const host = text(body.show.host, 80);
        if (show !== undefined) status.show = host === undefined ? { name: show } : { name: show, host };
    }

    // Where to listen, as paths on the station's own address. A station serves /live.mp3 unless its
    // operator turned it off, and the others only when turned on, so the answer is the only way to know.
    if (Array.isArray(body.mounts)) {
        const mounts = body.mounts
            .filter(mount => typeof mount === 'object' && mount !== null && MOUNT_PATH.test(mount.path ?? '') && MOUNT_FORMATS.includes(mount.format))
            .slice(0, 8)
            .map(({ format, path }) => ({ format, path }));
        if (mounts.length > 0) status.mounts = mounts;
    }

    if (typeof body.track === 'object' && body.track !== null) {
        const { kind } = body.track;
        const artist = text(body.track.artist, 200);
        const title = text(body.track.title, 200);
        if ((kind === 'record' || kind === 'break') && title !== undefined) {
            status.track = artist === undefined ? { kind, title } : { kind, artist, title };
        }
    }
    return status;
}

/**
 * One station's entry in status.json.
 *
 * @param {{ answer?: unknown, checkedAt: string, previous?: { lastAnsweredAt?: string } }} input
 */
export function stationStatus({ answer, checkedAt, previous }) {
    const read = answer === undefined ? undefined : readNowPlaying(answer);
    if (read === undefined) {
        const lastAnsweredAt = previous?.lastAnsweredAt;
        return lastAnsweredAt === undefined ? { state: 'unreachable', checkedAt } : { state: 'unreachable', checkedAt, lastAnsweredAt };
    }
    const { onAir, ...rest } = read;
    return { state: onAir ? 'on-air' : 'off-air', checkedAt, lastAnsweredAt: checkedAt, ...rest };
}

/**
 * Stations that have not answered for {@link QUIET_DAYS}, for the run's summary. A station that has
 * never answered counts from when it was listed.
 *
 * @param {Record<string, { state: string, lastAnsweredAt?: string }>} stations
 * @param {Record<string, string>} listedOn slug to the entry's dateAdded
 * @param {string} now
 */
export function quietStations(stations, listedOn, now) {
    const cutoff = Date.parse(now) - QUIET_DAYS * 24 * 60 * 60 * 1000;
    return Object.entries(stations)
        .filter(([slug, status]) => status.state === 'unreachable' && Date.parse(status.lastAnsweredAt ?? listedOn[slug] ?? now) < cutoff)
        .map(([slug]) => slug)
        .sort();
}
