// Season 1 league roster: 16 fighters curated from the 75 Phase-1 MAP-Elites
// elites + the Phase-0 Moth. Deliberate blend: top-Elo killers AND the most
// alien/high-novelty minds. Curation rationale lives in
// /private/tmp/league-season1-report.md (mini) — summarized:
//   Killers (repertoire Elo): 1120 (1621), 2211 (1606), 0221 (1600), 1220 (1566),
//     1221 (1550, 6/6 discovery wins), 1212 (1476, 6/6, novelty 0.543),
//     1210 (7-node, 5 wins, 755 dmg)
//   Weirdos (novelty/policy-entropy): 1222 (polH 1.29, revenge latch, stale-track
//     ambush, bullet-lane sidestep), 0222 (polH 1.21, 420u kite), 2222 (novelty
//     1.00), 2022 (novelty 0.706, last-known-position tracker), 1020 (7-node
//     minimalist), 1010 (4-node minimalist), 0121 (polH 1.21, 28 nodes),
//     0210 (bank-charge)
//   Legacy: bt-n1 "Moth" (Phase-0 GP champion v0.2.0)

export interface LeagueFighter {
    /** Genome id, e.g. 'bt-p1-1120' or 'bt-n1'. */
    id: string;
    /** Fight name for the season. */
    name: string;
    /** Repo-root-relative path of the genome JSON. */
    genomePath: string;
}

/** Session-only lineup id prefix for league fighters (imported-robot style). */
export const LEAGUE_ID_PREFIX = 'custom:league-';

export function leagueLineupId(id: string): string {
    return `${LEAGUE_ID_PREFIX}${id}`;
}

const P1 = 'src/robots/bt/genomes/map-elites';

export const FIGHTERS: LeagueFighter[] = [
    { id: 'bt-p1-1120', name: 'Warden', genomePath: `${P1}/bt-p1-1120.genome.json` },
    { id: 'bt-p1-2211', name: 'Blackout', genomePath: `${P1}/bt-p1-2211.genome.json` },
    { id: 'bt-p1-0221', name: 'Cyclone', genomePath: `${P1}/bt-p1-0221.genome.json` },
    { id: 'bt-p1-1220', name: 'Drifter', genomePath: `${P1}/bt-p1-1220.genome.json` },
    { id: 'bt-p1-1221', name: 'Pulse', genomePath: `${P1}/bt-p1-1221.genome.json` },
    { id: 'bt-p1-1212', name: 'Survivor', genomePath: `${P1}/bt-p1-1212.genome.json` },
    { id: 'bt-p1-1210', name: 'Scalpel', genomePath: `${P1}/bt-p1-1210.genome.json` },
    { id: 'bt-p1-1222', name: 'Poltergeist', genomePath: `${P1}/bt-p1-1222.genome.json` },
    { id: 'bt-p1-0222', name: 'Mirage', genomePath: `${P1}/bt-p1-0222.genome.json` },
    { id: 'bt-p1-2222', name: 'Outlier', genomePath: `${P1}/bt-p1-2222.genome.json` },
    { id: 'bt-p1-2022', name: 'Tracker', genomePath: `${P1}/bt-p1-2022.genome.json` },
    { id: 'bt-p1-1020', name: 'Occam', genomePath: `${P1}/bt-p1-1020.genome.json` },
    { id: 'bt-p1-1010', name: 'Mote', genomePath: `${P1}/bt-p1-1010.genome.json` },
    { id: 'bt-p1-0121', name: 'Banshee', genomePath: `${P1}/bt-p1-0121.genome.json` },
    { id: 'bt-p1-0210', name: 'Banker', genomePath: `${P1}/bt-p1-0210.genome.json` },
    { id: 'bt-n1', name: 'Moth', genomePath: 'src/robots/bt/genomes/moth-v0.2.0.genome.json' },
];
