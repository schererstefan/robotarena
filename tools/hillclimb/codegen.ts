// Champion freeze: codegen a registry bot from the winning genome —
// src/robots/<id>.ts (tuned params as named constants + `// tuned:` comment,
// optimized loadout, bumped version, hillclimb author), append-only registry
// + sources entries, ROBOT_API.md table row, champions/<id>.json record.
//
// The generated bot delegates its update loop to the base archetype's
// parameterized factory, so frozen behavior is the champion genome exactly,
// by construction rather than by template fidelity.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadoutCode, type SkillLoadout } from '../../src/sim/skills';
import { genomeHash, genomeLoadout, type Genome } from '../../src/robots/genome';
import { brawlerParamsFromGenome } from '../../src/robots/brawler';
import { ghostParamsFromGenome } from '../../src/robots/ghost';
import { hunterParamsFromGenome } from '../../src/robots/hunter';
import { orbiterParamsFromGenome } from '../../src/robots/orbiter';
import { rusherParamsFromGenome } from '../../src/robots/rusher';
import { sniperParamsFromGenome } from '../../src/robots/sniper';
import { turretParamsFromGenome } from '../../src/robots/turret';
import { wandererParamsFromGenome } from '../../src/robots/wanderer';
import { getRobot } from '../../src/robots/registry';
import type { ValidationMatch } from './manifest';

export interface FreezeRequest {
    archetype: string;
    genome: Genome;
    runId: string;
    trainMean: number;
    validMean: number;
    validation: ValidationMatch[];
}

export interface FreezeResult {
    id: string;
    files: string[];
}

/** Next free champion id: <archetype>-hc<N>, scanning the live registry. */
export function nextChampionId(archetype: string): string {
    let n = 1;
    while (getRobot(`${archetype}-hc${n}`)) n += 1;
    return `${archetype}-hc${n}`;
}

function toCamel(id: string): string {
    return id
        .split('-')
        .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
}

function capitalize(id: string): string {
    return id.charAt(0).toUpperCase() + id.slice(1);
}

function bumpPatch(version: string): string {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m) return `${version}+hc`;
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function renderLoadout(loadout: SkillLoadout): string {
    const parts = Object.entries(loadout)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([skill, rank]) => `${skill}: ${rank}`);
    return `{ ${parts.join(', ')} }`;
}

const PARAMS_FROM_GENOME: Record<string, (genome: Genome) => unknown> = {
    brawler: brawlerParamsFromGenome,
    ghost: ghostParamsFromGenome,
    hunter: hunterParamsFromGenome,
    orbiter: orbiterParamsFromGenome,
    rusher: rusherParamsFromGenome,
    sniper: sniperParamsFromGenome,
    turret: turretParamsFromGenome,
    wanderer: wandererParamsFromGenome,
};

function renderParams(archetype: string, genome: Genome): string {
    const fromGenome = PARAMS_FROM_GENOME[archetype];
    if (!fromGenome) throw new Error(`no codegen template for archetype ${archetype}`);
    const params = { ...(fromGenome(genome) as Record<string, unknown>) };
    return Object.entries(params)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, value]) => `    ${key}: ${typeof value === 'string' ? `'${value}'` : JSON.stringify(value)},`)
        .join('\n');
}

function baseImport(archetype: string): { factory: string; paramsType: string; createCall: string } {
    const cap = capitalize(archetype);
    if (!PARAMS_FROM_GENOME[archetype] || !/^[A-Za-z]+$/.test(archetype)) throw new Error(`no codegen template for archetype ${archetype}`);
    return { factory: `createWithParams as create${cap}Params`, paramsType: `${cap}Params`, createCall: `create${cap}Params` };
}

function renderSource(opts: { id: string; name: string; base: string; version: string; runId: string; hash: string; loadout: SkillLoadout; genome: Genome }): string {
    const { factory, paramsType, createCall } = baseImport(opts.base);
    return `// ${opts.name}: hillclimb champion bred from ${opts.base}. Do not hand-edit:
// re-run the tuner (\`npm run tune -- --archetype ${opts.base}\`) instead.
// tuned: run ${opts.runId} genome ${opts.hash}

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { ${factory}, type ${paramsType} } from './${opts.base}';

export const meta: RobotMeta = {
    id: '${opts.id}',
    name: '${opts.name}',
    author: 'RobotArena (hillclimb)',
    version: '${opts.version}',
    description: 'Hillclimb champion bred from ${opts.base} (run ${opts.runId}).',
};

export const loadout: SkillLoadout = ${renderLoadout(opts.loadout)};

/** Tuned behavior params (run ${opts.runId}). */
export const PARAMS: ${paramsType} = {
${renderParams(opts.base, opts.genome)}
};

export function create(): RobotController {
    const inner = ${createCall}(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
`;
}

export function freezeChampion(root: string, req: FreezeRequest): FreezeResult {
    const base = getRobot(req.archetype);
    if (!base) throw new Error(`unknown archetype ${req.archetype}`);
    const id = nextChampionId(req.archetype);
    const camel = toCamel(id);
    const baseCamel = toCamel(req.archetype);
    const name = `${capitalize(req.archetype)} HC${id.slice(id.lastIndexOf('-hc') + 3)}`;
    const version = bumpPatch(base.meta.version);
    const hash = genomeHash(req.genome);
    const loadout = genomeLoadout(req.genome);
    const files: string[] = [];

    // 1. The champion module.
    const sourcePath = join(root, 'src', 'robots', `${id}.ts`);
    if (existsSync(sourcePath)) throw new Error(`champion source already exists: ${sourcePath}`);
    writeFileSync(
        sourcePath,
        renderSource({ id, name, base: req.archetype, version, runId: req.runId, hash, loadout, genome: req.genome }),
    );
    files.push(sourcePath);

    // 2. Registry import + entry (append-only: existing lines untouched).
    const registryPath = join(root, 'src', 'robots', 'registry.ts');
    const registry = readFileSync(registryPath, 'utf8').split('\n');
    const lastImport = registry.filter((l) => l.startsWith('import ')).pop();
    if (!lastImport) throw new Error('codegen anchor not found: registry imports');
    const importIdx = registry.lastIndexOf(lastImport);
    const entryIdx = registry.lastIndexOf('];');
    if (importIdx < 0 || entryIdx < 0) throw new Error('codegen anchor not found: registry structure');
    registry.splice(importIdx + 1, 0, `import { create as create${capitalize(camel)}, loadout as ${camel}Loadout, meta as ${camel}Meta } from './${id}';`);
    const entryShift = entryIdx + 1;
    registry.splice(entryShift, 0, `    { meta: ${camel}Meta, loadout: ${camel}Loadout, create: create${capitalize(camel)} },`);
    writeFileSync(registryPath, `${registry.join('\n')}`);
    files.push(registryPath);

    // 3. Raw-source export map (append-only).
    const sourcesPath = join(root, 'src', 'robots', 'sources.ts');
    const sources = readFileSync(sourcesPath, 'utf8').split('\n');
    const srcImports = sources.filter((l) => l.startsWith('import '));
    const srcImportIdx = sources.lastIndexOf(srcImports[srcImports.length - 1] as string);
    const srcEndIdx = sources.lastIndexOf('};');
    if (srcImportIdx < 0 || srcEndIdx < 0) throw new Error('codegen anchor not found: sources structure');
    sources.splice(srcImportIdx + 1, 0, `import ${camel}Src from '../robots/${id}.ts?raw';`);
    sources.splice(srcEndIdx + 1, 0, `    ${id.includes('-') ? `'${id}'` : id}: ${camel}Src,`);
    writeFileSync(sourcesPath, sources.join('\n'));
    files.push(sourcesPath);

    // 4. ROBOT_API.md: champion row at the end of the built-in table.
    const docsPath = join(root, 'docs', 'ROBOT_API.md');
    const docs = readFileSync(docsPath, 'utf8').split('\n');
    const ghostIdx = docs.findIndex((l) => l.startsWith('| Ghost |'));
    if (ghostIdx < 0) throw new Error('codegen anchor not found: ROBOT_API.md table');
    let tableEnd = ghostIdx;
    while (tableEnd + 1 < docs.length && (docs[tableEnd + 1] as string).startsWith('|')) tableEnd += 1;
    docs.splice(tableEnd + 1, 0, `| ${name} | Hillclimb champion bred from ${baseCamel} (run ${req.runId}). | \`${loadoutCode(loadout)}\` |`);
    const countIdx = docs.findIndex((l) => l.includes('Eight bots ship in'));
    if (countIdx >= 0) docs[countIdx] = (docs[countIdx] as string).replace('Eight bots ship in', 'Eight base bots ship in');
    writeFileSync(docsPath, docs.join('\n'));
    files.push(docsPath);

    // 5. Champion record for the leaderboard/showcase track.
    const championsDir = join(root, 'tools', 'hillclimb', 'champions');
    mkdirSync(championsDir, { recursive: true });
    const recordPath = join(championsDir, `${id}.json`);
    writeFileSync(
        recordPath,
        `${JSON.stringify(
            {
                botId: id,
                baseBot: req.archetype,
                runId: req.runId,
                genomeHash: hash,
                genome: req.genome,
                trainMean: req.trainMean,
                validMean: req.validMean,
                featuredReplays: req.validation.map((v) => ({ label: `vs ${v.opponent} (${v.arena}, seed ${v.seed})`, code: v.code, outcome: v.score === 1 ? 'win' : v.score === 0.5 ? 'draw' : 'loss' })),
            },
            null,
            1,
        )}\n`,
    );
    files.push(recordPath);

    return { id, files };
}
