"""Castle kit dimensions — the single source of the numbers the sim (js/sim/castle.js) and the renderer
(js/render/castle.js) read back from assets/castle-kit.json. Change them here, rebuild every piece."""
MOD = 6.0            # siege module length (b.mods), m; curtain pieces are one module long
HT = 1.3             # curtain half thickness -> 2.6 m (sim DIMS.curtain.th)
FOUND = -2.0         # foundations run below ground so a piece can sit on a slope
WALK_Z = 8.0         # curtain wall-walk height (level 1 network; gatehouse chamber, tower doors at this height)
PARA_T = 0.6         # parapet thickness (outer skin of the wall-head)
WALK_Y0 = -HT + PARA_T   # walk surface from the parapet's inner face ...
WALK_Y1 = HT             # ... to the wall's inner (bailey) edge: 2.0 m of walk
WALK_W = WALK_Y1 - WALK_Y0
WALK_YC = (WALK_Y0 + WALK_Y1) / 2
SILL = 1.2           # breastwork height above a walk (crenel sill)
MERLON_H = 1.13      # merlon height above the sill (+0.17 coping = parapet top 2.5 m above the walk: sim h 10.5)
MERLON_W = 2.1
CRENEL_W = 0.9
PITCH = MERLON_W + CRENEL_W   # 3.0 -> two crenels per module, joints inside merlons
PLINTH_H = 2.2       # batter at the foot of the outer face
PLINTH_OUT = 0.6
COPING = 0.17
# wall classes (js/sim/castle.js DIMS.curtain / inner / outer): walk height, half thickness, parapet, sill, merlon, plinth
WALLS = {
    "main":  dict(walk=8.0,  ht=1.3, para=0.6, sill=1.2, merlon=1.13, plinth=2.2, plinth_out=0.6),
    "inner": dict(walk=10.0, ht=1.5, para=0.7, sill=1.2, merlon=1.13, plinth=2.6, plinth_out=0.7),
    "outer": dict(walk=5.5,  ht=1.1, para=0.6, sill=1.1, merlon=0.73, plinth=1.6, plinth_out=0.5),
}
# towers (sim: r 5.5 at the ring's corners, 0.9 x that mid-curtain; top = walk + 5.5; floors [0, walk/2, walk, top])
TWR_ABOVE = 5.5
TWR_R = 5.5          # round tower outer radius (11 m diameter); the renderer scales x,y by r / 5.5
TWR_SQ = 5.0         # square tower half side (10 x 10 m)
TWR_WALL = 2.09       # sim: ri = r - min(2.2, 0.38 r)
TWR_FLOORS = [0.0, 4.0, WALK_Z, WALK_Z + 5.5]   # storey floors; the last is the open fighting top
TWR_DOORS = 16       # walk-level doorway sockets round a round tower (every 22.5 deg), each closed by a plug node
LADDER_ANGLE = 75.0  # degrees from horizontal for a scaling ladder
# gatehouse (sim DIMS.gate: w 17 along the curtain, d 15, passage 3.4; b0 = -0.42 d inside, b1 = 0.58 d outside)
GATE_W, GATE_D, GATE_PASS = 17.0, 15.0, 3.4
# keep (sim DIMS.keep: 20 x 20, floors [0, 6, 13.5, 21], walls 3 m)
KEEP_W, KEEP_D, KEEP_FLOORS, KEEP_TH = 20.0, 20.0, [0.0, 6.0, 13.5, 21.0], 3.0
