// Shared, identical performance constants for every robot.
// Fairness rule: robot code may read these but the engine is the only
// writer of state, and all intents are clamped to these limits.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const MAX_TICKS = TICK_HZ * 150; // 2.5 minute match cap, then draw

export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 640;

export const ROBOT_RADIUS = 14;
export const START_HEALTH = 100;

// Chassis base values (same for all robots; skills modify per loadout).
export const MAX_SPEED = 150; // units per second at full throttle
export const REVERSE_FACTOR = 0.6; // reverse is slower than forward
export const ACCEL = 340; // units per second^2 toward target speed
export const TURN_RATE = 2.7; // radians per second at full turn input

// Sensor tower base values (same for all robots; skills modify per loadout).
export const TOWER_RATE = 3.6; // radians per second at full tower input
export const SENSOR_RANGE = 540;
export const SENSOR_FOV = 1.1; // full cone width in radians (~63 deg)

// Gun base values (same for all robots; skills modify per loadout).
export const GUN_RANGE = 470;
export const GUN_COOLDOWN_TICKS = 24; // 0.4s between shots
export const BULLET_SPEED = 430;
export const BULLET_DAMAGE = 12;
export const BULLET_RADIUS = 3;
