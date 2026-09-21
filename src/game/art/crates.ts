// Obstacle face-plates from the LOCKED obstacle sheet, top row
// (native 16x16 medallions, box-sampled, <=6 colors each). Centered over the
// tiled barrier base in BattleScene; variant picked deterministically.

type PixelMap = string[];

// CRATE_A: hazard-striped plate.
// Opaque colors: hklmsw.
export const CRATE_A: PixelMap = [
    '.wwwmwwwwwlswww.',
    '.wwlmwwwwwwmlww.',
    'sllklhklhhlklhhw',
    'lhkhhkllklkshksh',
    'lhmkhhhsskshkmhl',
    '.mhhkksskmskhhh.',
    '.slmsmmmwlmsmlm.',
    '.llhmmmllmmmhll.',
    '.llhmmmmmmmmhll.',
    '.llsmmmmmmmmsll.',
    '.lmssmmmmmmsssh.',
    '.lmhksssmhhkhll.',
    '.mmhllllllllmhm.',
    'wllmmmmmmmmmmllw',
    'mhmlmsmmmmhllmhh',
    'kkkhkksssskhkhkk',
];

// CRATE_B: teal X-brace plate.
// Opaque colors: bdgkmw.
export const CRATE_B: PixelMap = [
    'wwwmmgmmgmmmgwww',
    'wggdkkkkkkkkdggg',
    'wmdkbggggggbddmg',
    'kkkdggwwwwwbdkkk',
    'mdbkdgwwwgbddbdm',
    'mdggddbwwbdkgbmm',
    'mmgwwddbbddgwgmm',
    'mmgwwwdddkgwwgmm',
    'mmgwwwbddmwwwgmm',
    'mdgwwbddkdbwwgmd',
    'mmgwbddgwddmwgdm',
    'mmbbdkgwwwddmbdk',
    'mmmddbwwwwgddmmg',
    'wggdbbggwggbdwgw',
    'wggdmmmmmmmmmggg',
    'dkddkkkkkkkkkmkd',
];

// CRATE_C: rust hazard-band plate.
// Opaque colors: chklmw.
export const CRATE_C: PixelMap = [
    '.......wl.......',
    '................',
    '.wwwwhlwhcwhwww.',
    '.wwwkkwklwkllwl.',
    '.wmmhwkhcklcmml.',
    '.hhkhhkhhkkkkhh.',
    '.wlhmmlllllmllm.',
    '.lwklllllllllll.',
    '.wlmllllllllllw.',
    '.wmhlllllllllhl.',
    '.hhmlllllllmlll.',
    '.llmllmlllllllm.',
    '.wwlhhhmmhmhwww.',
    '.wllklckwckcwlw.',
    '.lmllckcckcllll.',
    '.mhmckhckllkhhh.',
];
