// Ghost: a fast hit-and-run scout. Darts into gun range while the gun is
// ready, fires, then breaks away on the cooldown and circles for the next
// pass. Never trades shots standing still.

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../sim/constants';
import { angleDiff, TAU } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, createStallTracker, dodgeVector, leadAngle, rayClearance, steerTo } from './common';
import { castContact, latestContact } from './comms';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'ghost',
    name: 'Ghost',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Fast hit-and-run scout: darts in on a ready gun, vanishes on cooldown.',
};

export const loadout: SkillLoadout = { overdrive: 1, gyro: 2, wideband: 1, scout: 1, plating: 1 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface GhostParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    orbitDir: 1 | -1;
    strikeRangeFrac: number;
    tangentFrac: number;
    fleeFrac: number;
    dodgeRange: number;
    dodgeClearance: number;
    alignTol: number;
    orbitThrottle: number;
    turnThrottle: number;
    scanTurn: number;
    breakRange: number;
    targetPolicy: BrainTargetPolicy;
}

export const GHOST_DEFAULTS: GhostParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.07,
    orbitDir: 1,
    strikeRangeFrac: 0.85,
    tangentFrac: 0.7,
    fleeFrac: 0.45,
    dodgeRange: 170,
    dodgeClearance: 50,
    alignTol: 1.1,
    orbitThrottle: 1,
    turnThrottle: 0.4,
    scanTurn: 1,
    breakRange: 320,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build ghost params from a validated genome (unknown keys fall to defaults). */
export function ghostParamsFromGenome(genome: Genome): GhostParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        steerGain: num('steer.gain', GHOST_DEFAULTS.steerGain),
        turretGain: num('turret.gain', GHOST_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', GHOST_DEFAULTS.aimTol),
        orbitDir: p['orbit.dir'] === -1 ? -1 : 1,
        strikeRangeFrac: num('engage.rangeFrac', GHOST_DEFAULTS.strikeRangeFrac),
        tangentFrac: num('orbit.tangentFrac', GHOST_DEFAULTS.tangentFrac),
        fleeFrac: num('orbit.fleeFrac', GHOST_DEFAULTS.fleeFrac),
        dodgeRange: num('dodge.range', GHOST_DEFAULTS.dodgeRange),
        dodgeClearance: num('dodge.clearance', GHOST_DEFAULTS.dodgeClearance),
        alignTol: num('drive.alignTol', GHOST_DEFAULTS.alignTol),
        orbitThrottle: num('drive.orbitThrottle', GHOST_DEFAULTS.orbitThrottle),
        turnThrottle: num('drive.turnThrottle', GHOST_DEFAULTS.turnThrottle),
        scanTurn: num('search.scanTurn', GHOST_DEFAULTS.scanTurn),
        breakRange: num('engage.breakRange', GHOST_DEFAULTS.breakRange),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : GHOST_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<GhostParams>): RobotController {
    const p: GhostParams = { ...GHOST_DEFAULTS, ...overrides };
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;
    const stall = createStallTracker();

    function update(sense: SenseState): Intent {
        const self = sense.self;
        // Scout blips are live positions: chase them like contacts. The tower
        // swings onto the blip bearing and converts it to a real sighting.
        const foe = pickTarget(sense.foes, p.targetPolicy) ?? sense.scout[0];
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        // Team contacts: when blind, chase a teammate's reported position
        // and swing the tower onto it — stale, but better than empty air.
        const contact = foe ? null : latestContact(sense.inbox);
        if (contact) {
            lastX = contact.x;
            lastY = contact.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const toGoal = Math.atan2(goalY - self.y, goalX - self.x);

        // Gun ready: run at the target. Cooling down: break away tangentially
        // so the pass becomes an orbit, not a retreat into a corner.
        let drive = toGoal;
        if (foe) {
            const tangent = toGoal + (p.orbitDir * Math.PI) / 2;
            const strikeRange = self.stats.gunRange * p.strikeRangeFrac;
            if (self.cooldown > 0 || foe.distance < strikeRange * p.tangentFrac) {
                drive = tangent;
                if (foe.distance < strikeRange * p.fleeFrac) drive = toGoal + Math.PI;
            }
        }
        // Imminent incoming fire in the cone: sidestep the lane — but never
        // jink a live shot. Dodging is for the cooldown gaps; when the gun
        // speaks this tick, the firing run holds its line.
        const shotAt = foe ? leadAngle(self.x, self.y, self.stats.bulletSpeed, foe) : undefined;
        const firing = foe !== undefined && shotAt !== undefined && self.cooldown <= 0 && foe.distance < self.stats.gunRange && aimed(self.tower, shotAt, p.aimTol);
        const incoming = sense.bullets ?? [];
        let nearest = Infinity;
        for (const b of incoming) {
            if (b.closing > 0 && b.distance < nearest) nearest = b.distance;
        }
        if (!firing && nearest < p.dodgeRange) {
            const dodge = dodgeVector(self.x, self.y, incoming);
            if (dodge.x !== 0 || dodge.y !== 0) {
                // Never dodge into a wall or block: prefer the sidestep with
                // running room, and hold the line when both sides are shut.
                const obstacles = sense.arena?.obstacles ?? [];
                const a = Math.atan2(dodge.y, dodge.x);
                const clearA = rayClearance(self.x, self.y, a, obstacles);
                const clearB = rayClearance(self.x, self.y, a + Math.PI, obstacles);
                if (clearA > p.dodgeClearance) drive = a;
                else if (clearB > p.dodgeClearance) drive = a + Math.PI;
            }
        }
        // Pinned on a wall or block (blips lure through cover): sidestep off.
        if (stall.update(sense.tick, self.x, self.y, true)) drive += Math.PI / 2;
        drive = ((drive % TAU) + TAU) % TAU;
        const turn = steerTo(self.heading, drive, p.steerGain);
        const facing = Math.abs(angleDiff(self.heading, drive)) < p.alignTol;
        // Lead the shot (computed above): wanderers and strafers die to
        // intercept bearings, not tower-on-bearing snapshots. Blips carry
        // zero velocity, so the lead degrades to the bearing gracefully.
        const shot = shotAt;
        const contactBearing = contact ? Math.atan2(contact.y - self.y, contact.x - self.x) : null;
        const towerTurn = shot !== undefined ? aimTurret(self.tower, shot, p.turretGain) : contactBearing !== null ? aimTurret(self.tower, contactBearing, p.turretGain) : p.scanTurn; // wide sweep
        const fire = shot !== undefined && foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, shot, p.aimTol);
        // Break contact on cooldown: dash out of the pocket and EMP the
        // pursuer so the next pass starts at our range, not theirs.
        const breaking = self.cooldown > 0 && foe !== undefined && foe.distance < p.breakRange;
        const dash = breaking && self.dashCd <= 0;
        const emp = breaking && self.empCd <= 0 && (foe?.distance ?? Infinity) < EMP_RADIUS;
        return {
            throttle: facing ? p.orbitThrottle : p.turnThrottle,
            turn,
            towerTurn,
            fire,
            charge: false,
            dash,
            emp,
            radio: foe ? castContact(foe.x, foe.y, foe.id) : null,
        };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
