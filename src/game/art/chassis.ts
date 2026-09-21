// Chassis C1 (concept pass): all face EAST (+x), 16x16.
// Converted from the LIKED robot-chassis-sheet (Stefan: review pass, not locked).
// Method (deterministic, native scale only): tight-crop each concept cell,
// box-average downsample to 16x16 (area sampling, no blur, no faux-pixel),
// rotate to east (portrait-up reads as north; ghost dart nose reads as down
// so it rotates counter-clockwise, all others clockwise), nearest game-palette
// snap (`t` reserved), isolated-pixel kill, rarest-color merge to 8 base
// colors so the team lens keeps every map at 8-9 opaque colors (the 8 art:qa
// color-budget flags are the accepted chassis deviation, preserved).
// Team identity is trim/lens-only: `t` (baked per-team by the engine track)
// marks the visor/cockpit lens; hulls stay neutral. No separate trim stripe
// in this pass (lens-only trim, kept small); reviewer may request stripes.
// Shading chars: k d m l w + s/h cool-shadow support; `c` warm specular.
// Palette has no purple (banned hue family): the violet spider concept bakes
// to blue-slate instead.
// Source cells (robot-chassis-sheet, 4x2 grid): cell0 red tracker, cell1 blue
// twin-cannon, cell2 green X droid, cell3 yellow tank, cell4 violet spider,
// cell5 cyan mech, cell6 orange tractor, cell7 rose dart.

export const CHASSIS_V2: Record<string, string[]> = {
    // Red tracked gunner, amber core forward. Team lens: core cluster.
    // Opaque colors: adhopqst.
    rusher: [
        'ppdqd.....pqqsq.',
        'q.h.h..qq..h.h.q',
        'q.hddppaapqqdh.q',
        'pppaoqhhhhqahqq.',
        '...aodhsshsoa...',
        '..pqshsqqhhqq...',
        '.pqshaqaoahsa...',
        '.aassqhtttqdhqqd',
        '.aassq.ttaqdhqqq',
        '.qqsha.aaahsa...',
        '..pqshsqqhhqq...',
        '...aodhsshsoq...',
        'ppphaphhhsqaqqp.',
        'q.hddppaapqqdh.q',
        'q.h.hq.qp..h.h.q',
        'pqddd.....pqdsq.',
    ],
    // Bulky cyan mech, twin side pods, tread flanks. Team lens: cockpit block.
    // Opaque colors: bdhlmpqst.
    turret: [
        '.qqqqdbbbbbs....',
        'qhhhhsbbbmbbhhhd',
        'qshhhsbbbbbbhhhd',
        'pdddssbbbbbbsssq',
        '.sshsbbbbssmmms.',
        '.shmsbbbbbsmmhs.',
        'dbblmbsbbbbbbbs.',
        '.dsmsbbttbsbbbb.',
        '.ssmsbbttbsbbbb.',
        'sbblhbsbbbbbbbs.',
        '.dshsbbbbbdhmhs.',
        '.smmsbbbbbhmlmsd',
        'pdddssbbbbbbsssq',
        'qshhhsbbbbbbhhhd',
        'qshhhsbbhmbbhhhd',
        '.qdqqdbbbbbs....',
    ],
    // Green X-wing droid, split wing planes. Team lens: lens block.
    // Opaque colors: adghmpqst.
    orbiter: [
        '.......qq.......',
        '......qdad......',
        '..h..qsdagd.ph..',
        '..dmpshdhagqmd..',
        '...ddhhmmhgdd...',
        '..qsssmmmmhhmd..',
        '.pdddshddhhshhq.',
        'qddsmmmttmmgghhd',
        'qddsmmmttmmgmhsd',
        '.pddddhddhddshq.',
        '..qsshmmmmshmd..',
        '...ddhhmmhadd...',
        '..dmpshdsagqmd..',
        '..h..qsdagq.ph..',
        '......qdad......',
        '.......qq.......',
    ],
    // Violet spider-bug, leg nubs all sides. Team lens: pale core bar.
    // Opaque colors: bdhklmqst.
    wanderer: [
        '.hss............',
        'sdkssmmms.......',
        'sdkddshhq.......',
        '.hss.khh..dss...',
        '.....qmmhmsmmhd.',
        '...ssqbbbbsshsd.',
        '...sskdsmmlhq...',
        '..dmbbhtttlllq..',
        '..dmbbsssmmmhk..',
        '...ssksdssmsq...',
        '...ssqbbbbsdhsd.',
        '.....qmmhmsmmhd.',
        '.sss.khh..dss...',
        'sdkdsshh........',
        'ddkdsmmms.......',
        '.hss............',
    ],
    // Blue twin-cannon gunner, visor band. Team lens: visor block.
    // Opaque colors: bdhlmpqst.
    sniper: [
        '....dssdss......',
        '...dbbbbbbb.....',
        '..dsbbbbsbbb....',
        '..sbbbsbsbssq...',
        '.ssbbssdsbbmlmmh',
        'dsbbbssbssbbhdds',
        'ddssssbbbsdbs...',
        'ssbbbbsbttsbsp..',
        'dsbbbbsbttsbsp..',
        'ssssssbbbsdbs...',
        'dsbbbssbssbbhdss',
        '.bbbbssdsbbhmmmh',
        '.pssbbsbsbssq...',
        '..dsbbbbsbbb....',
        '...dbbbbbbb.....',
        '....dbsdss......',
    ],
    // Orange tractor, cab windows, hammer arm aft. Team lens: window spine.
    // Opaque colors: adhmopqst.
    brawler: [
        '.ppqqqq.........',
        'pddqooooahq.....',
        'qs.qaaooaadq....',
        'pddqaaaaqhq.....',
        '.qaaaaaataaq....',
        '.paaoooooaa.....',
        '.qaoaoaaaoos....',
        '.daoaoaaaooqq...',
        '.pqaooootaa.....',
        '.qooaaooooaq....',
        'pqqqaaaaqp...hs.',
        'qs.qaaooaaap.mmm',
        'qhsqoaoot.pq.mms',
        '.ppqahhd....hmmp',
        '...........mmmq.',
        '............hm..',
    ],
    // Rose arrowhead dart, swept fins. Team lens: sight dot.
    // Opaque colors: dhlmqrstw.
    ghost: [
        '.....hmh........',
        '....hlllh.......',
        '....mrrllh......',
        '.qrmllmqqq......',
        'hmmmllrrrhd.....',
        '..hmhhrrmrrrd...',
        '.mlwrqhlrrrrrd..',
        '.mlwlmmltwwlhhh.',
        '.mlwlhmltwwlhmm.',
        '.mlwrqhlrrrrrd..',
        '..hmrhrrmrrrs...',
        'hmmhllrrrhs.....',
        '.drmllmqqq......',
        '....hrrllh......',
        '....hllrh.......',
        '.....hmh........',
    ],
    // Yellow tank, side pods, dark scope visor. Team lens: visor block.
    // Opaque colors: acdhoqsty.
    hunter: [
        '....aaahac......',
        '....qqqdsss.....',
        '....dssshhh.....',
        '..qqayyyyoycqq..',
        '.aooaccccyyccoy.',
        '.aaaaaaaaaaaaaq.',
        'aycyyccydaaoyyyh',
        'aycyayctthhayycc',
        'aycyoyctthhayycc',
        'aycyaycydaaoyyys',
        '.aaaaaaaaqaaaaq.',
        '.ayyaccccyyccoy.',
        '..qqayyyyoycqa..',
        '....ddsshhh.....',
        '....qdddsss.....',
        '....aaaaacd.....',
    ],
};
