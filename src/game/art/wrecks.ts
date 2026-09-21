// Destroyed-wreck pixel maps, 16x16 each, facing EAST like CHASSIS in
// src/game/art.ts. Palette chars: .=transparent,k,d,m,l,w,y.
// Rendered static at the death position; these read as wreckage, not robots.
//
// Three wreck concepts (2-3 robots each, varied per robot):
//   SPLIT HULL (rusher, hunter, sniper) — hull cracked open along the
//     midline: peeled top shell with a jagged k break line, dark exposed
//     interior (d) with rib seams and amber ember dots (y), slumped lower
//     hull. Hunter's nose is snapped clean off and lies detached; sniper is
//     broken into two offset halves with a transparent crack gap.
//   CRUSHED SLAB (turret, brawler) — pancaked silhouette (shorter than the
//     live hull): caved-in crater pit (k rim, d fill, y ember), crack seams,
//     sheared/slumped edges. Brawler shears sideways, turret caves center.
//   SHATTERED DEBRIS (orbiter, wanderer, ghost) — no contiguous hull: a
//     scorched core chunk plus 2-3 separated panels with transparent gaps,
//     ground embers. Ghost slid east into a scatter trail.
// Team trim is gone (burned off per the damage rules), so no `t` — identity
// comes from the corpse shape, scorch (k/d), and embers (y). Light stays
// top-left: `l` on up/left remnant edges, `d` low-right.

export const WRECKS: Record<string, string[]> = {
    // SPLIT HULL: peeled shell, exposed core, drooping nose.
    rusher: [
        '................',
        '...kkk..........',
        '..klllwkk.......',
        '..klwwwwwkk.....',
        '..kwwkdkkwkk....',
        '..kkkkkkkkkk....',
        '..kdddydddmk....',
        '..kdkdkdkdkk....',
        '..kdddydddkk....',
        '..kkkkkkkkkd....',
        '..klllwwwwdd....',
        '..kwmmmmwwdk....',
        '..kwwwwmddyk....',
        '...kkkkkkk......',
        '..kk..y...kk....',
        '................',
    ],
    // SPLIT HULL: nose snapped off, lying detached east of the open hull.
    hunter: [
        '................',
        '..kkkk..........',
        '.klllwkk........',
        '.klwwwwkk.......',
        '.kkwkkkkk.......',
        '.kddddddk.......',
        '.kdkydddk..kk...',
        '.kdddkddk.kwwkk.',
        '.kkkkkkkk.kwdk..',
        '.klllwwwk..kk...',
        '.kwmmmwwk.......',
        '.kwwwwddk..y....',
        '..kkkkkk........',
        '...kk..kk.......',
        '................',
        '................',
    ],
    // SPLIT HULL: snapped in two — rear hull west, front half offset
    // south-east across a transparent crack gap.
    sniper: [
        '................',
        '................',
        '..kkkk..........',
        '.klllwkk........',
        '.klwwwwwk.......',
        '.kkkkkkkk.......',
        '.kddddddk.......',
        '.kdkydddkk......',
        '.kdddddddk.kk...',
        '..kkkkkkk.kwwk..',
        '..klllwwk.kwdk..',
        '..kkkkkkk..kk...',
        '..........kwwk..',
        '..........kwyk..',
        '...........kk...',
        '................',
    ],
    // CRUSHED SLAB: pancaked, center crater with an ember pit.
    turret: [
        '................',
        '................',
        '................',
        '................',
        '..kkkkkkkkkk....',
        '.klllwlllwlllk..',
        '.klwwkkkkkwwlk..',
        '.kwwmkdddkwmwk..',
        '.kwwmkdydkwwkk..',
        '.kwmmmkkkmmwwk..',
        '.kwwmmmddmmwwk..',
        '..kkkkkkkkkkkk..',
        '...y..kk...y....',
        '................',
        '................',
        '................',
    ],
    // CRUSHED SLAB: sheared sideways, side crater, slumped base.
    brawler: [
        '................',
        '................',
        '................',
        '...kkkkkkkkk....',
        '..klllwwlllkk...',
        '..klwwwwwlwwk...',
        '..kwmkkkkmmwwk..',
        '...kmkdddkmmwk..',
        '...kmkdydkmmwkk.',
        '....kmmkkmmwwdk.',
        '....kwwwwwmddk..',
        '.....kkkkkkkk...',
        '......y...y.....',
        '................',
        '................',
        '................',
    ],
    // SHATTERED DEBRIS: scorched core plus separated panels north/south.
    orbiter: [
        '................',
        '................',
        '........kkk.....',
        '.......klllwk...',
        '.......kwmwkk...',
        '........kkk.....',
        '..kkkk..........',
        '.klllwkk........',
        '.klwkywkk.......',
        '.kwmdmwkk.......',
        '..kkkkkk..kk....',
        '.........kwk....',
        '.....kk..kk.....',
        '.....kwk..yk....',
        '.....kkk........',
        '................',
    ],
    // SHATTERED DEBRIS: three chunks scattered in a triangle, ember core.
    wanderer: [
        '................',
        '..kkk...........',
        '.klllwk.........',
        '.klwwmwk........',
        '..kkkkk.........',
        '................',
        '.......kkkk.....',
        '......kllllwk...',
        '......klwkywk...',
        '......kwwmwk....',
        '......kkkkk.....',
        '................',
        '...kkk..........',
        '..kwwwk.........',
        '..kwydk.........',
        '...kkk..........',
    ],
    // SHATTERED DEBRIS: slid east — core west, panels and ember trail.
    ghost: [
        '................',
        '................',
        '................',
        '..kkk...........',
        '.klllwk.........',
        '.klwkwkkk.......',
        '.kwwkywkk.kk....',
        '..kkkkkk.kwwk...',
        '.........kwdk...',
        '.........kkk....',
        '...........kkk..',
        '...........kwk..',
        '............y...',
        '................',
        '................',
        '................',
    ],
};
