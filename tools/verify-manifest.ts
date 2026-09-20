// Manifest verifier (hillclimb plan §1.7/§1.8): the trust root for Phase A
// submissions. Re-sims every replay code carried by the public manifests —
// leaderboard showcase codes must decode and run to completion, showcase
// featured codes must additionally reproduce their claimed outcome.
// Usage: npm run verify:manifests [-- public/leaderboard.json public/data/showcase.json]
// Exit codes: 0 all verify, 1 any failure.

import { existsSync, readFileSync } from 'fs';
import { parseOnlineBoard } from '../src/game/onlineBoard';
import { parseShowcaseManifest } from '../src/game/showcase';
import { resimReplay } from './eval/resim';

function fail(message: string): void {
    console.log(`  MISMATCH ${message}`);
}

function verifyBoard(path: string): boolean {
    if (!existsSync(path)) {
        console.log(`${path}: missing`);
        return false;
    }
    const board = parseOnlineBoard(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (!board) {
        console.log(`${path}: schema invalid`);
        return false;
    }
    let checked = 0;
    let ok = true;
    for (const entry of board.entries) {
        if (entry.showcaseCode === '') continue;
        checked += 1;
        const resim = resimReplay(entry.showcaseCode, entry.botId);
        if (!resim) {
            ok = false;
            fail(`${path} ${entry.botId}: showcase code does not re-sim`);
        }
    }
    console.log(`${path}: board schema ok, ${checked}/${board.entries.length} showcase codes re-sim`);
    return ok;
}

function verifyShowcase(path: string): boolean {
    if (!existsSync(path)) {
        console.log(`${path}: missing`);
        return false;
    }
    const manifest = parseShowcaseManifest(JSON.parse(readFileSync(path, 'utf8')) as unknown);
    if (!manifest) {
        console.log(`${path}: schema invalid`);
        return false;
    }
    let checked = 0;
    let ok = true;
    for (const champ of manifest.champions) {
        for (const rep of champ.featuredReplays) {
            checked += 1;
            const resim = resimReplay(rep.code, champ.botId);
            if (!resim) {
                ok = false;
                fail(`${path} ${champ.botId} "${rep.label}": code does not re-sim`);
            } else if (resim.outcome !== rep.outcome) {
                ok = false;
                fail(`${path} ${champ.botId} "${rep.label}": re-simmed ${resim.outcome}, claimed ${rep.outcome}`);
            }
        }
    }
    console.log(`${path}: showcase schema ok, ${checked} featured codes checked`);
    return ok;
}

function main(paths: string[]): number {
    const targets = paths.length > 0 ? paths : ['public/leaderboard.json', 'public/data/showcase.json'];
    let ok = true;
    for (const path of targets) {
        if (path.includes('showcase')) ok = verifyShowcase(path) && ok;
        else ok = verifyBoard(path) && ok;
    }
    console.log(ok ? 'verify-manifests: ALL CHECKS PASSED' : 'verify-manifests: FAILURES');
    return ok ? 0 : 1;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('verify.mjs') || invoked.endsWith('verify.cjs') || invoked.endsWith('verify-manifest.ts')) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
