// Pilot mode: a human drives one robot through the same Intent pipeline as
// AI controllers. BattleScene feeds key/pointer state into PilotInput; the
// sim just sees another RobotController, so the engine stays untouched.

import { aimTurret } from '../robots/common';
import type { SkillLoadout } from '../sim/skills';
import { ROBOT_API_VERSION, type Intent, type RobotController, type RobotMeta, type SenseState } from '../sim/types';

/**
 * Mutable input state owned by the scene and read fresh on every sim tick.
 * Space both banks charge (while held, on charger builds) and fires: one
 * shot is queued on press for snap fire and one on release for the charged
 * shot. The engine's cooldown gate keeps taps to a single shot.
 */
export class PilotInput {
    forward = false;
    back = false;
    left = false;
    right = false;
    strafeLeft = false;
    strafeRight = false;
    /** Aim point in arena coordinates (the same frame as sense.self x/y). */
    aimX = 0;
    aimY = 0;
    /** True while Space is held. */
    charging = false;
    private queuedShots = 0;

    queueShot(): void {
        this.queuedShots += 1;
    }

    consumeShot(): boolean {
        if (this.queuedShots <= 0) return false;
        this.queuedShots = 0;
        return true;
    }
}

/**
 * Wrap a lineup slot's identity (meta + default loadout) with human input.
 * The underlying AI is never instantiated; rendering, naming, and export
 * keep working off the slot's robot id.
 */
export function createPilotController(
    meta: RobotMeta,
    loadout: SkillLoadout | undefined,
    input: PilotInput,
): RobotController {
    const update = (sense: SenseState): Intent => {
        const self = sense.self;
        const target = Math.atan2(input.aimY - self.y, input.aimX - self.x);
        return {
            throttle: (input.forward ? 1 : 0) + (input.back ? -1 : 0),
            turn: (input.right ? 1 : 0) + (input.left ? -1 : 0),
            towerTurn: aimTurret(self.tower, target),
            fire: input.consumeShot(),
            charge: input.charging,
            strafe: (input.strafeRight ? 1 : 0) + (input.strafeLeft ? -1 : 0),
        };
    };
    return { meta, api: ROBOT_API_VERSION, loadout, update };
}
