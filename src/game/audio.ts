// Procedural WebAudio sound engine: every effect is synthesized from
// oscillators + filtered noise, so the game ships zero audio assets.
// The AudioContext is created lazily inside unlockAudio(), which scenes call
// from a user gesture (autoplay policy: a context created outside a gesture
// starts suspended). All play* functions are safe no-ops before unlock.
//
// Routing: voices -> bus (sfx/ui/music) -> master mute gain ->
// DynamicsCompressor -> destination. Every voice carries a SHOOT_MIN_GAP-
// style rate limit so furballs duck instead of clipping.

import { ARENA_WIDTH } from '../sim/constants';
import { clamp } from '../sim/math';

const MUTE_KEY = 'robotarena_muted';
const MASTER_GAIN = 0.35;
const SHOOT_MIN_GAP = 0.06;
const HIT_MIN_GAP = 0.05;
const EXPLOSION_MIN_GAP = 0.15;
const STING_MIN_GAP = 1.0;
const DASH_MIN_GAP = 0.2;
const EMP_MIN_GAP = 0.2;
const SD_MIN_GAP = 0.9;
const HOVER_MIN_GAP = 0.06;
const UI_MIN_GAP = 0.05;

type BusName = 'sfx' | 'ui' | 'music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let uiBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = loadMuted();
let lastShootAt = 0;
let lastHitAt = 0;
let lastExplosionAt = 0;
let lastStingAt = 0;
let lastDashAt = 0;
let lastEmpAt = 0;
let lastSdAt = 0;
let lastHoverAt = 0;
let lastUiAt = 0;

function loadMuted(): boolean {
    try {
        return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
        return false;
    }
}

function audioCtor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create/resume the shared context. Call from a pointer/key handler. */
export function unlockAudio(): void {
    const Ctor = audioCtor();
    if (Ctor === null) return;
    if (ctx === null) {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER_GAIN;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 20;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        master.connect(comp);
        comp.connect(ctx.destination);
        sfxBus = ctx.createGain();
        uiBus = ctx.createGain();
        musicBus = ctx.createGain();
        sfxBus.connect(master);
        uiBus.connect(master);
        musicBus.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume();
}

export function isMuted(): boolean {
    return muted;
}

export function setMuted(next: boolean): void {
    muted = next;
    try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
        // Private-mode storage: the toggle still applies for this session.
    }
    if (master !== null && ctx !== null) {
        master.gain.setValueAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime);
    }
}

export function toggleMuted(): boolean {
    setMuted(!muted);
    return muted;
}

/** Stop every music source (battle loop + ambience) + reset the duck. */
export function stopMusic(): void {
    stopBattleLoop();
    stopAmbience();
    if (ctx === null || musicBus === null) return;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(1, ctx.currentTime);
}

function busFor(name: BusName): GainNode | null {
    return name === 'sfx' ? sfxBus : name === 'ui' ? uiBus : musicBus;
}

/** Arena x -> stereo pan (-0.8 left .. +0.8 right). */
export function panFor(x: number): number {
    return clamp(x / ARENA_WIDTH, 0, 1) * 1.6 - 0.8;
}

/** Slight center attenuation: mono-ish voices sit back a touch. */
function attenuate(pan: number): number {
    return 0.85 + 0.15 * Math.min(Math.abs(pan), 1);
}

/** ±8% pitch jitter: stacked voices never phase-flange. */
function pitch(hz: number): number {
    return hz * (1 + (Math.random() * 2 - 1) * 0.08);
}

/** ±20% gain jitter: repeated hits stay organic. */
function level(gain: number): number {
    return gain * (1 + (Math.random() * 2 - 1) * 0.2);
}

function tone(
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    dur: number,
    gain: number,
    delay = 0,
    bus: BusName = 'sfx',
    pan = 0,
): void {
    if (ctx === null || muted) return;
    const out = busFor(bus);
    if (out === null) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(fromHz, 1), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), t0 + dur);
    g.gain.setValueAtTime(gain * attenuate(pan), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        g.connect(panner);
        panner.connect(out);
    } else {
        g.connect(out);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

function noise(
    dur: number,
    gain: number,
    fromHz: number,
    toHz: number,
    delay = 0,
    bus: BusName = 'sfx',
    pan = 0,
): void {
    if (ctx === null || muted) return;
    const out = busFor(bus);
    if (out === null) return;
    if (noiseBuffer === null) {
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(fromHz, 20), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(toHz, 20), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * attenuate(pan), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        g.connect(panner);
        panner.connect(out);
    } else {
        g.connect(out);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

/** Laser blip, layered when charged. Rate-limited: battles fire constantly. */
export function playShoot(charged: boolean, x: number = ARENA_WIDTH / 2): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastShootAt < SHOOT_MIN_GAP) return;
    lastShootAt = now;
    const pan = panFor(x);
    tone('square', pitch(720 + Math.random() * 240), 180, 0.08, level(0.1), 0, 'sfx', pan);
    if (charged) {
        tone('sawtooth', pitch(190), 60, 0.18, level(0.16), 0, 'sfx', pan);
        noise(0.12, level(0.08), 4000, 500, 0, 'sfx', pan);
    }
}

/** Impact in 3 tiers by damage: light / heavy / massive. */
export function playHit(damage: number, x: number = ARENA_WIDTH / 2): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastHitAt < HIT_MIN_GAP) return;
    lastHitAt = now;
    const pan = panFor(x);
    const tier = damage <= 14 ? 0 : damage <= 28 ? 1 : 2;
    tone('triangle', pitch(260), 70, 0.12, level(0.22), 0, 'sfx', pan);
    noise(0.08, level(0.1), 3000, 800, 0, 'sfx', pan);
    if (tier >= 1) {
        tone('square', pitch(180), 50, 0.15, level(0.22), 0.01, 'sfx', pan);
        noise(0.12, level(0.14), 4500, 600, 0, 'sfx', pan);
    }
    if (tier >= 2) {
        tone('sine', pitch(120), 30, 0.3, level(0.3), 0.02, 'sfx', pan);
    }
}

/** Kill: initial crack + fireball body + low rumble tail. */
export function playExplosion(x: number = ARENA_WIDTH / 2): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastExplosionAt < EXPLOSION_MIN_GAP) return;
    lastExplosionAt = now;
    const pan = panFor(x);
    noise(0.06, 0.3, 6000, 1000, 0, 'sfx', pan);
    tone('square', pitch(300), 60, 0.1, level(0.2), 0, 'sfx', pan);
    tone('sine', pitch(130), 28, 0.5, level(0.35), 0, 'sfx', pan);
    noise(0.45, level(0.25), 2500, 120, 0, 'sfx', pan);
    tone('sine', 70, 24, 0.9, 0.2, 0.1, 'sfx', pan);
    noise(0.8, 0.1, 300, 60, 0.1, 'sfx', pan);
    duckMusic();
}

/** Dash whoosh: rising air + a light lift tone. */
export function playDash(x: number = ARENA_WIDTH / 2): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastDashAt < DASH_MIN_GAP) return;
    lastDashAt = now;
    const pan = panFor(x);
    noise(0.18, level(0.14), 800, 4200, 0, 'sfx', pan);
    tone('sine', 200, 520, 0.15, 0.07, 0, 'sfx', pan);
}

/** EMP zap: collapsing saw + static burst. */
export function playEmp(x: number = ARENA_WIDTH / 2): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastEmpAt < EMP_MIN_GAP) return;
    lastEmpAt = now;
    const pan = panFor(x);
    tone('sawtooth', 1200, 100, 0.25, level(0.16), 0, 'sfx', pan);
    noise(0.15, level(0.1), 5000, 500, 0, 'sfx', pan);
}

/** Sudden-death alarm: double low pulse (scene-throttled ~1/s). */
export function playSuddenDeath(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastSdAt < SD_MIN_GAP) return;
    lastSdAt = now;
    tone('square', 220, 220, 0.14, 0.12);
    tone('square', 220, 220, 0.14, 0.12, 0.2);
}

/** Battle start: rising triad over the spawn-in. */
export function playBattleStart(): void {
    if (ctx === null || muted) return;
    const notes = [261.63, 392.0, 523.25];
    notes.forEach((hz, i) => tone('triangle', hz, hz, 0.12, 0.14, i * 0.09, 'ui'));
}

/** Two-note kill sting (first blood). Gated: ducks, never stacks. */
export function playSting(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastStingAt < STING_MIN_GAP) return;
    lastStingAt = now;
    tone('square', 440, 440, 0.09, 0.14);
    tone('square', 660, 660, 0.14, 0.14, 0.09);
}

export function playClick(): void {
    tone('square', 1400, 1100, 0.035, 0.06, 0, 'ui');
}

/** Button hover tick. Throttled: pointerover fires per control. */
export function playHover(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastHoverAt < HOVER_MIN_GAP) return;
    lastHoverAt = now;
    tone('square', 1800, 1600, 0.025, 0.035, 0, 'ui');
}

/** Dialog success (replay accepted, import landed). */
export function playConfirm(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastUiAt < UI_MIN_GAP) return;
    lastUiAt = now;
    tone('triangle', 660, 880, 0.09, 0.12, 0, 'ui');
    tone('triangle', 990, 990, 0.08, 0.1, 0.07, 'ui');
}

/** Dialog error (bad code, failed import). */
export function playError(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastUiAt < UI_MIN_GAP) return;
    lastUiAt = now;
    tone('square', 220, 160, 0.12, 0.12, 0, 'ui');
}

export function playWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((hz, i) => tone('triangle', hz, hz, 0.16, 0.18, i * 0.12, 'music'));
}

/** Defeat: descending line, same weight as the win arp. */
export function playLose(): void {
    const notes = [392.0, 311.13, 261.63, 196.0];
    notes.forEach((hz, i) => tone('triangle', hz, hz, 0.16, 0.18, i * 0.15, 'music'));
}

/** Draw: neutral resolving pair (neither triumph nor defeat). */
export function playDraw(): void {
    tone('triangle', 493.88, 493.88, 0.15, 0.16, 0, 'music');
    tone('triangle', 440.0, 440.0, 0.22, 0.16, 0.16, 'music');
}

// ---- Music: battle-drum lookahead scheduler + menu ambience --------------
// The scheduler ticks on a 25 ms interval and renders up to 120 ms ahead,
// so drums stay on-grid under frame hitches. Density follows the intensity
// callback (alive-ratio + damage-rate, supplied render-side by the scene).
// Every scheduling pass checks `muted`; scenes stop the loop on shutdown.

const MUSIC_BPM = 132;
const SCHED_INTERVAL_MS = 25;
const SCHED_AHEAD_S = 0.12;

let battleTimer: ReturnType<typeof setInterval> | null = null;
let battleStep = 0;
let battleNextAt = 0;
let battleIntensity: () => number = () => 0.5;
let ambienceTimer: ReturnType<typeof setInterval> | null = null;

/** −6 dB duck on explosions: the kit yields, never stacks. */
function duckMusic(): void {
    if (ctx === null || musicBus === null || muted) return;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(0.5, t);
    musicBus.gain.linearRampToValueAtTime(1, t + 0.5);
}

export function startBattleLoop(intensity: () => number): void {
    stopBattleLoop();
    battleIntensity = intensity;
    battleStep = 0;
    battleNextAt = 0;
    battleTimer = setInterval(scheduleBattle, SCHED_INTERVAL_MS);
}

export function stopBattleLoop(): void {
    if (battleTimer !== null) {
        clearInterval(battleTimer);
        battleTimer = null;
    }
}

function scheduleBattle(): void {
    if (ctx === null || muted || musicBus === null) return;
    if (battleNextAt < ctx.currentTime) battleNextAt = ctx.currentTime + 0.05;
    const sixteenth = 60 / MUSIC_BPM / 4;
    while (battleNextAt < ctx.currentTime + SCHED_AHEAD_S) {
        scheduleStep(battleStep, Math.max(battleNextAt - ctx.currentTime, 0));
        battleNextAt += sixteenth;
        battleStep = (battleStep + 1) % 16;
    }
}

/** One 16th step: kick on quarters, hats widening with heat, tom stabs. */
function scheduleStep(step: number, delay: number): void {
    const k = clamp(battleIntensity(), 0, 1);
    if (step % 4 === 0) {
        tone('sine', 150, 40, 0.12, 0.22 + 0.2 * k, delay, 'music');
        noise(0.03, 0.06, 3000, 800, delay, 'music');
    }
    if (step % 2 === 0) {
        if (k > 0.3) noise(0.04, 0.05 + 0.05 * k, 8000, 5000, delay, 'music');
    } else if (k > 0.7) {
        noise(0.03, 0.05, 9000, 6000, delay, 'music');
    }
    if ((step === 10 || step === 14) && k > 0.5) {
        tone('triangle', 220, 90, 0.12, 0.16, delay, 'music');
    }
}

/** Menu ambience: a slow detuned pad (A2–C#4), re-triggered every 2 s. */
export function startMenuAmbience(): void {
    stopAmbience();
    schedulePad();
    ambienceTimer = setInterval(schedulePad, 2000);
}

export function stopAmbience(): void {
    if (ambienceTimer !== null) {
        clearInterval(ambienceTimer);
        ambienceTimer = null;
    }
}

const PAD_NOTES = [110, 164.81, 220, 277.18];

function schedulePad(): void {
    if (ctx === null || muted) return;
    for (const hz of PAD_NOTES) {
        tone('triangle', hz * 0.99, hz, 1.8, 0.035, Math.random() * 0.3, 'music');
        tone('sine', hz * 1.01, hz, 1.8, 0.03, Math.random() * 0.3, 'music');
    }
}
