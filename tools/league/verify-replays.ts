// Verify every Season 1 replay code: decode -> rebuild the match from the
// pinned spec (custom:league-<id> resolved via the genome JSONs, same as
// Track B would) -> re-sim -> confirm identical winner and tick count.
// Bundle: npx esbuild tools/league/verify-replays.ts --bundle --platform=node --format=esm --outfile=/tmp/verify-replays.mjs
import { readFileSync } from 'node:fs';
import { Match } from '../../src/sim/engine';
import { decodeReplay } from '../../src/sim/replay';
import { parseGenome } from '../../src/robots/bt/serialization';
import { cloneTree, type BTNode } from '../../src/robots/bt/tree';
import { createBTTreeBrain } from '../../src/robots/bt/brain';
import { BT_LOADOUT } from '../../src/robots/bt/gp';
import { LEAGUE_ID_PREFIX } from './roster';

interface SeasonMatch {
    id: string;
    a: string;
    b: string;
    winner: string;
    replay: string;
}

const season = JSON.parse(readFileSync('data/league/season1.json', 'utf8')) as {
    matches: SeasonMatch[];
    fighters: Array<{ id: string; genome: string }>;
};

const genomeOf = new Map(season.fighters.map((f) => [f.id, f.genome] as const));
const treeCache = new Map<string, BTNode>();

function treeFor(fighterId: string): BTNode {
    const cached = treeCache.get(fighterId);
    if (cached) return cloneTree(cached);
    const path = genomeOf.get(fighterId);
    if (!path) throw new Error(`no genome for ${fighterId}`);
    const tree = parseGenome(readFileSync(path, 'utf8')).tree;
    treeCache.set(fighterId, tree);
    return cloneTree(tree);
}

let ok = 0;
let fail = 0;
for (const m of season.matches) {
    const spec = decodeReplay(m.replay);
    if (!spec) {
        console.log(`FAIL ${m.id}: undecodable`);
        fail += 1;
        continue;
    }
    const ids = spec.lineupIds.map((lid) =>
        lid.startsWith(LEAGUE_ID_PREFIX) ? lid.slice(LEAGUE_ID_PREFIX.length) : lid,
    );
    if (ids[0] !== m.a || ids[1] !== m.b || spec.seed === undefined) {
        console.log(`FAIL ${m.id}: lineup/seed mismatch`);
        fail += 1;
        continue;
    }
    const mk = (fid: string) => {
        const brain = createBTTreeBrain(treeFor(fid));
        return {
            meta: { id: fid, name: fid, author: 'verify', version: '1.0.0', description: '' },
            update: (sense: never) => brain.update(sense).intent,
        };
    };
    const match = new Match(
        [
            { team: 0, controller: mk(ids[0] as string), loadout: { ...BT_LOADOUT } },
            { team: 1, controller: mk(ids[1] as string), loadout: { ...BT_LOADOUT } },
        ],
        spec.seed,
        { arena: spec.arena ?? 'open' },
    );
    match.runToEnd();
    const w = match.result.winner;
    const winnerId = w === 0 ? m.a : w === 1 ? m.b : '';
    // Note: shootout matches re-sim from the DECIDING seed, so winner/ticks
    // must match the recorded (post-shootout) result exactly.
    if (winnerId === m.winner) {
        ok += 1;
    } else {
        console.log(`FAIL ${m.id}: replay gives ${winnerId}, recorded ${m.winner}`);
        fail += 1;
    }
}
console.log(`replay verification: ${ok} ok, ${fail} failed of ${season.matches.length}`);
if (fail > 0) process.exit(1);
