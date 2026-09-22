// Animated menu banner: extruded gold title, traveling light sweep, glow
// pulse, and drifting ember sparks over the night-arena vista.
//
// RENDER-ONLY. This module never touches sim state: motion is driven by the
// scene clock/tweens plus a fixed-seed PRNG baked at build time. No
// nondeterministic or wall-clock calls anywhere here, so menu cosmetics
// cannot leak into battle determinism.

import { BlendModes, Scene } from 'phaser';
import { APP } from './strings';
import { COLORS, FONTS } from './theme';

/** Fixed seed: the ember field is identical every boot (pose is f(time)). */
const EMBER_SEED = 0xba44e5;
const EMBER_COUNT = 26;

/** Deterministic PRNG (mulberry32): cosmetic layout only, never sim. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Ember {
    sprite: Phaser.GameObjects.Image;
    x0: number;
    y0: number;
    speed: number;
    swayAmp: number;
    swayFreq: number;
    phase: number;
    flickFreq: number;
    baseAlpha: number;
}

function ensureGlowTexture(scene: Scene): void {
    if (scene.textures.exists('menu_banner_glow')) return;
    const g = scene.add.graphics();
    // Stacked ellipses fake a soft radial amber falloff (ADD-blended).
    for (let i = 8; i >= 1; i -= 1) {
        g.fillStyle(0xffb340, 0.05);
        g.fillEllipse(256, 64, (512 * i) / 8, (128 * i) / 8);
    }
    g.fillStyle(0xffd23f, 0.08);
    g.fillEllipse(256, 64, 300, 64);
    g.generateTexture('menu_banner_glow', 512, 128);
    g.destroy();
}

function ensureDotTexture(scene: Scene): void {
    if (scene.textures.exists('menu_banner_dot')) return;
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(3, 3, 2.6);
    g.generateTexture('menu_banner_dot', 6, 6);
    g.destroy();
}

function ensureBarTexture(scene: Scene): void {
    if (scene.textures.exists('menu_banner_bar')) return;
    const g = scene.add.graphics();
    // Left-transparent -> right-solid amber bar with a bright gold core.
    for (let i = 0; i <= 20; i += 1) {
        const t = i / 20;
        g.fillStyle(0xb07c2a, t * 0.9);
        g.fillRect((160 * i) / 20, 0, 9, 9);
    }
    g.fillStyle(0xffd23f, 0.95);
    g.fillRect(40, 3, 120, 2);
    g.generateTexture('menu_banner_bar', 160, 9);
    g.destroy();
}

/** Extrude stack under the gold face: dark steel deep, bronze near top. */
const EXTRUDE = ['#05070a', '#141c26', '#2b3542', '#54431c', '#8a6420'];

export class MenuBanner {
    private readonly root: Phaser.GameObjects.Container;
    private readonly glow: Phaser.GameObjects.Image;
    private readonly embers: Ember[] = [];
    private readonly reduced: boolean;

    constructor(scene: Scene, parent: Phaser.GameObjects.Container, x: number, y: number, reduced: boolean) {
        this.reduced = reduced;
        ensureGlowTexture(scene);
        ensureDotTexture(scene);
        ensureBarTexture(scene);

        this.root = scene.add.container(x, y);

        // Soft amber aura + faint dark plaque so the letters hold over
        // bright vista patches.
        this.glow = scene.add.image(0, 6, 'menu_banner_glow').setBlendMode(BlendModes.ADD);
        const plaque = scene.add.rectangle(0, 6, 760, 118, 0x06080b, 0.38);
        this.root.add([plaque, this.glow]);

        // 3D depth: dark-steel extrude stack under the gold face.
        const titleStyle = { ...FONTS.title, fontSize: '40px', letterSpacing: 12 };
        for (let i = EXTRUDE.length - 1; i >= 0; i -= 1) {
            const layer = scene.add
                .text(0, (i + 1) * 2, APP.title, { ...titleStyle, color: EXTRUDE[i] as string })
                .setOrigin(0.5);
            this.root.add(layer);
        }
        const face = scene.add.text(0, 0, APP.title, { ...titleStyle, color: COLORS.goldCss }).setOrigin(0.5);
        face.setShadow(0, 3, '#000', 8, true, true);
        this.root.add(face);

        // Traveling light sweep: a bright copy of the face revealed through
        // a narrow crop window that glides across the word. Cropping (not
        // masking) keeps the shine exactly on the letterforms.
        const shine = scene.add
            .text(0, 0, APP.title, { ...titleStyle, color: '#fff6d8' })
            .setOrigin(0.5)
            .setAlpha(0.8)
            .setBlendMode(BlendModes.ADD);
        this.root.add(shine);
        const bandW = 84;
        const sweepFrom = -bandW;
        const sweepTo = face.width + bandW;
        const proxy = { v: sweepFrom };
        const applyCrop = (): void => {
            // Crop rect is in texture space: shift by half the text width.
            shine.setCrop(proxy.v - face.width / 2, 0, bandW, shine.height);
        };
        applyCrop();
        if (!reduced) {
            scene.tweens.add({
                targets: proxy,
                v: sweepTo,
                duration: 2600,
                ease: 'Sine.easeInOut',
                repeat: -1,
                repeatDelay: 1500,
                onUpdate: applyCrop,
            });
            scene.tweens.add({
                targets: this.glow,
                alpha: { from: 0.55, to: 0.95 },
                scaleX: { from: 1, to: 1.06 },
                duration: 2100,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1,
            });
        } else {
            shine.setAlpha(0);
        }

        // Flanking gradient bars replace the old flat flourishes; gold
        // diamonds with teal cores cap the outer ends.
        const barY = 2;
        const half = face.width / 2;
        const barL = scene.add.image(-half - 118, barY, 'menu_banner_bar').setFlipX(true);
        const barR = scene.add.image(half + 118, barY, 'menu_banner_bar');
        const diaL = scene.add.rectangle(-half - 216, barY, 10, 10, COLORS.gold).setRotation(Math.PI / 4);
        const diaR = scene.add.rectangle(half + 216, barY, 10, 10, COLORS.gold).setRotation(Math.PI / 4);
        const coreL = scene.add.rectangle(-half - 216, barY, 4, 4, 0x35d0ff).setRotation(Math.PI / 4);
        const coreR = scene.add.rectangle(half + 216, barY, 4, 4, 0x35d0ff).setRotation(Math.PI / 4);
        this.root.add([barL, barR, diaL, diaR, coreL, coreR]);

        // Ember sparks drifting around the banner (seeded layout, clock pose).
        const rng = mulberry32(EMBER_SEED);
        const tints = [0xffd23f, 0xffd23f, 0xffb340, 0xffb340, 0x35d0ff];
        for (let i = 0; i < EMBER_COUNT; i += 1) {
            const tint = tints[Math.floor(rng() * tints.length) % tints.length] as number;
            const sprite = scene.add
                .image(0, 0, 'menu_banner_dot')
                .setTint(tint)
                .setScale(0.35 + rng() * 0.5)
                .setBlendMode(BlendModes.ADD);
            this.embers.push({
                sprite,
                x0: (rng() * 2 - 1) * 400,
                y0: 20 + rng() * 180,
                speed: 6 + rng() * 14,
                swayAmp: 6 + rng() * 18,
                swayFreq: 0.2 + rng() * 0.5,
                phase: rng() * Math.PI * 2,
                flickFreq: 1 + rng() * 3,
                baseAlpha: 0.35 + rng() * 0.5,
            });
            this.root.add(sprite);
        }
        this.pose(0);

        parent.add(this.root);
    }

    /** Advance the ember field. timeMs comes from the scene clock (render-only). */
    update(timeMs: number): void {
        if (this.reduced) return;
        this.pose(timeMs / 1000);
    }

    private pose(t: number): void {
        const TAU = Math.PI * 2;
        const span = 190;
        for (const e of this.embers) {
            // Rise and wrap across the banner band; sway + flicker by phase.
            const y = 200 - ((((200 - e.y0 + t * e.speed) % span) + span) % span);
            e.sprite.setPosition(e.x0 + e.swayAmp * Math.sin(TAU * e.swayFreq * t + e.phase), y - 95);
            e.sprite.setAlpha(e.baseAlpha * (0.6 + 0.4 * Math.sin(TAU * e.flickFreq * t + e.phase * 2)));
        }
    }
}
