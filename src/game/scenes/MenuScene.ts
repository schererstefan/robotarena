// Main menu: mode select (1v1 / 2v2 / 3v3), per-slot robot picker plus
// cosmetic-only customization (callsign, paint, finish, trails).

import { Scene } from 'phaser';
import { ROBOTS } from '../../robots/registry';
import { COLORS, FONTS } from '../theme';
import { makeButton, makePanel } from '../ui';
import { CALLSIGNS, defaultSkin, FINISHES, PAINTS, randomSkin, type SlotSkin } from '../customize';

export interface BattleRequest {
    teamSize: number;
    lineupIds: string[];
    skins: SlotSkin[];
    trails: boolean;
    seed: number;
}

const CX = 512;

export class MenuScene extends Scene {
    private teamSize = 1;
    private lineupIds: string[] = ['hunter', 'orbiter'];
    private skins: SlotSkin[] = [defaultSkin('HUNTER', 0), defaultSkin('ORBITER', 1)];
    private trails = true;
    private slotObjects: Phaser.GameObjects.GameObject[] = [];
    private descText!: Phaser.GameObjects.Text;
    private modeButtons: Array<{ setLabel: (label: string) => void }> = [];
    private trailsButton!: { setLabel: (label: string) => void };

    constructor() {
        super('Menu');
    }

    create(): void {
        this.add.text(CX, 46, 'ROBOTARENA', FONTS.title).setOrigin(0.5);
        this.add
            .text(CX, 84, 'identical machines. only the code differs. (paint is free)', FONTS.small)
            .setOrigin(0.5);

        [1, 2, 3].forEach((size, i) => {
            const btn = makeButton(this, CX - 150 + i * 150, 138, 130, 42, '', () => this.setMode(size));
            this.modeButtons.push(btn);
        });
        this.refreshModeLabels();

        this.add.text(92, 178, 'SLOT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(200, 178, 'CALLSIGN', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(400, 178, 'ROBOT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(640, 178, 'PAINT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(742, 178, 'FINISH', FONTS.monoSmall).setOrigin(0, 0.5);
        this.rebuildSlots();

        makePanel(this, CX, 592, 880, 76);
        this.descText = this.add.text(CX - 420, 562, '', FONTS.body).setWordWrapWidth(840);
        this.showDescription(0);

        makeButton(this, CX - 160, 684, 260, 50, 'RANDOMIZE SKINS', () => this.randomizeSkins());
        makeButton(this, CX + 160, 684, 260, 50, 'START BATTLE', () => this.startBattle());
        this.trailsButton = makeButton(this, CX, 736, 200, 30, '', () => this.toggleTrails());
        this.refreshTrailsLabel();
    }

    private setMode(size: number): void {
        this.teamSize = size;
        const defaults = ['hunter', 'orbiter', 'rusher', 'turret', 'wanderer', 'hunter'];
        const nextIds: string[] = [];
        const nextSkins: SlotSkin[] = [];
        for (let i = 0; i < size * 2; i += 1) {
            const id = this.lineupIds[i] ?? (defaults[i] as string);
            nextIds.push(id);
            const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
            const old = this.skins[i];
            nextSkins.push(old ?? defaultSkin(entry.meta.name.toUpperCase(), i));
        }
        this.lineupIds = nextIds;
        this.skins = nextSkins;
        this.refreshModeLabels();
        this.rebuildSlots();
        this.showDescription(0);
    }

    private refreshModeLabels(): void {
        const labels = ['1 v 1', '2 v 2', '3 v 3'];
        this.modeButtons.forEach((btn, i) => {
            const active = i + 1 === this.teamSize;
            btn.setLabel(`${active ? '[ ' : ''}${labels[i]}${active ? ' ]' : ''}`);
        });
    }

    private refreshTrailsLabel(): void {
        this.trailsButton.setLabel(`TRAILS: ${this.trails ? 'ON' : 'OFF'}`);
    }

    private toggleTrails(): void {
        this.trails = !this.trails;
        this.refreshTrailsLabel();
    }

    private randomizeSkins(): void {
        this.skins = this.skins.map((skin) => randomSkin(skin.callsign));
        this.rebuildSlots();
    }

    private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.slotObjects.push(obj);
        return obj;
    }

    private rebuildSlots(): void {
        for (const obj of this.slotObjects) obj.destroy();
        this.slotObjects = [];

        const rows = this.teamSize * 2;
        const startY = rows <= 2 ? 252 : rows <= 4 ? 228 : 210;
        const step = rows <= 2 ? 84 : 64;
        for (let i = 0; i < rows; i += 1) {
            const y = startY + i * step;
            const team = (i < this.teamSize ? 0 : 1) as 0 | 1;
            const skin = this.skins[i] as SlotSkin;
            const entry = ROBOTS.find((r) => r.meta.id === this.lineupIds[i]) ?? ROBOTS[0]!;

            this.track(this.add.rectangle(100, y, 18, 18, COLORS.team[team]));
            this.track(this.add.text(118, y, `T${team + 1}·${i + 1}`, FONTS.monoSmall).setOrigin(0, 0.5));

            // Callsign cycler.
            const signBg = this.track(this.add.rectangle(285, y, 150, 40, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge));
            const signText = this.track(this.add.text(285, y, `${skin.callsign}  ▸`, FONTS.button).setOrigin(0.5));
            signText.setColor(skin.paintCss);
            signBg.setInteractive({ useHandCursor: true });
            signBg.on('pointerdown', () => this.cycleCallsign(i));

            // Robot cycler.
            const robotBg = this.track(this.add.rectangle(500, y, 200, 40, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge));
            this.track(this.add.text(500, y, `${entry.meta.name}  ▸`, FONTS.button).setOrigin(0.5));
            robotBg.setInteractive({ useHandCursor: true });
            robotBg.on('pointerdown', () => this.cycleRobot(i));

            // Paint swatch cycler.
            const paintBg = this.track(this.add.rectangle(672, y, 64, 40, skin.paint).setStrokeStyle(2, COLORS.panelEdge));
            paintBg.setInteractive({ useHandCursor: true });
            paintBg.on('pointerdown', () => this.cyclePaint(i));

            // Finish cycler.
            const finishBg = this.track(this.add.rectangle(792, y, 130, 40, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge));
            this.track(this.add.text(792, y, `${skin.finish}  ▸`, FONTS.button).setOrigin(0.5));
            finishBg.setInteractive({ useHandCursor: true });
            finishBg.on('pointerdown', () => this.cycleFinish(i));
        }
    }

    private cycleCallsign(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const idx = CALLSIGNS.indexOf(skin.callsign);
        const next = CALLSIGNS[(idx + 1) % CALLSIGNS.length] as string;
        this.skins[i] = { ...skin, callsign: next };
        this.rebuildSlots();
    }

    private cycleRobot(i: number): void {
        const current = this.lineupIds[i] as string;
        const idx = ROBOTS.findIndex((r) => r.meta.id === current);
        const next = ROBOTS[(idx + 1) % ROBOTS.length]!;
        this.lineupIds[i] = next.meta.id;
        this.rebuildSlots();
        this.showDescription(i);
    }

    private cyclePaint(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const idx = PAINTS.findIndex((p) => p.hex === skin.paint);
        const next = PAINTS[(idx + 1) % PAINTS.length]!;
        this.skins[i] = { ...skin, paint: next.hex, paintCss: next.css };
        this.rebuildSlots();
    }

    private cycleFinish(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const idx = FINISHES.indexOf(skin.finish);
        const next = FINISHES[(idx + 1) % FINISHES.length] as SlotSkin['finish'];
        this.skins[i] = { ...skin, finish: next };
        this.rebuildSlots();
    }

    private showDescription(i: number): void {
        const id = this.lineupIds[i] as string;
        const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
        this.descText.setText(
            `${entry.meta.name} by ${entry.meta.author} · v${entry.meta.version} — ${entry.meta.description}`,
        );
    }

    private startBattle(): void {
        this.scene.start('Battle', {
            teamSize: this.teamSize,
            lineupIds: [...this.lineupIds],
            skins: this.skins.map((s) => ({ ...s })),
            trails: this.trails,
            seed: (Math.random() * 0x7fffffff) | 0,
        } satisfies BattleRequest);
    }
}
