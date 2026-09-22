// Write one schema-versioned genome JSON file per archive elite under
// src/robots/bt/genomes/map-elites/<id>.genome.json. The archive cells
// already carry genome JSON strings; this just materializes them as the
// substrate's canonical genome-file artifacts.
//
// Usage: node gen-genomes.mjs --archive /tmp/p1c/archive.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name: string, def: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

const archivePath = arg('archive', '/tmp/p1c-archive.json');
const repoRoot = arg('repo-root', resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const outDir = resolve(repoRoot, 'src', 'robots', 'bt', 'genomes', 'map-elites');

const archive = JSON.parse(readFileSync(archivePath, 'utf8')) as {
    cells: Array<{ id: string; genome: string }>;
};
mkdirSync(outDir, { recursive: true });
let n = 0;
for (const cell of archive.cells) {
    const file = resolve(outDir, `${cell.id}.genome.json`);
    writeFileSync(file, cell.genome.endsWith('\n') ? cell.genome : `${cell.genome}\n`);
    n += 1;
}
console.log(`[gen-genomes] wrote ${n} genome files -> ${outDir}`);
