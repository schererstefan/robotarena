// Procedural WebAudio sound engine: every effect is synthesized from
// oscillators + filtered noise, so the game ships zero audio assets.
// The AudioContext is created lazily inside unlockAudio(), which scenes call
// from a user gesture (autoplay policy: a context created outside a gesture
// starts suspended). All play* functions are safe no-ops before unlock.

const MUTE_KEY = 'robotarena_muted';
const MASTER_GAIN = 0.35;
const SHOOT_MIN_GAP = 0.06;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = loadMuted();
let lastShootAt = 0;

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
        master.connect(ctx.destination);
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

function tone(type: OscillatorType, fromHz: number, toHz: number, dur: number, gain: number, delay = 0): void {
    if (ctx === null || master === null || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(fromHz, 1), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(toHz, 1), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain: number, fromHz: number, toHz: number, delay = 0): void {
    if (ctx === null || master === null || muted) return;
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
    filter.frequency.setValueAtTime(fromHz, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(toHz, 20), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
}

/** Short laser blip. Rate-limited: battles fire several shots per second. */
export function playShoot(): void {
    if (ctx === null || muted) return;
    const now = ctx.currentTime;
    if (now - lastShootAt < SHOOT_MIN_GAP) return;
    lastShootAt = now;
    tone('square', 720 + Math.random() * 240, 180, 0.08, 0.1);
}

export function playHit(): void {
    tone('triangle', 260, 70, 0.12, 0.22);
    noise(0.08, 0.1, 3000, 800);
}

export function playExplosion(): void {
    tone('sine', 130, 28, 0.5, 0.35);
    noise(0.45, 0.25, 2500, 120);
}

export function playClick(): void {
    tone('square', 1400, 1100, 0.035, 0.06);
}

export function playWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((hz, i) => tone('triangle', hz, hz, 0.16, 0.18, i * 0.12));
}
