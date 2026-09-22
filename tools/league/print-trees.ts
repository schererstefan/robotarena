// Print readable trees for curation candidates.
// Bundle: npx esbuild tools/league/print-trees.ts --bundle --platform=node --format=esm --outfile=/tmp/print-trees.mjs
import { readFileSync } from 'node:fs';
import { parseGenome } from '../../src/robots/bt/serialization';
import { printTree, treeSize } from '../../src/robots/bt/tree';

const ids = process.argv.slice(2);
for (const id of ids) {
  const path =
    id === 'bt-n1'
      ? 'src/robots/bt/genomes/moth-v0.2.0.genome.json'
      : `src/robots/bt/genomes/map-elites/${id}.genome.json`;
  const g = JSON.parse(readFileSync(path, 'utf8'));
  const tree = parseGenome(JSON.stringify(g)).tree;
  console.log(`### ${id} (nodes=${treeSize(tree)}, novelty=${g.fitness?.novelty01?.toFixed(3) ?? 'n/a'}, wins=${g.fitness?.wins ?? 'n/a'})`);
  console.log(printTree(tree));
  console.log();
}
