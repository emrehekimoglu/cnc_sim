# VMC-640 Machining Simulator (prototype)

A browser-based CNC milling simulator. It renders a 3-axis vertical machining center in real time: the material is removed as the program runs, chips fly off the cutter, coolant streams onto the tool, and a controller-style UI shows the position readout, spindle load, active G-code line and other machine state.

The physics is deliberately simplified. Look and feel come first.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. To make a static build in `dist/`, run `npm run build`.

## What's in it

**Three demo parts**, each generated as real G-code and run through a small interpreter:

| Program | Part | Operations |
|---|---|---|
| O1001 | Bracket Plate (120×80×31) | face mill, contoured shoulder, helical-entry pocket, Ø14 bores, G83 peck drilling, chamfer |
| O1003 | Hub Flange (100×100×31) | OD turn-off with G2 full circles, hub shoulder, hex socket, 6× holes on a bolt circle, chamfers |
| O1002 | Mould Insert (100×100×41) | Z-level raster roughing, then ball-nose 3D finishing (drop-cutter toolpaths) |

**Machine:** a VMC with an enclosure, a T-slot table, a vise sized to fit the stock, a moving table and saddle, telescopic way covers, a spindle head, a BT-style tool holder, articulated coolant hoses and a work lamp. It has six modelled cutters: a face mill with inserts, two fluted carbide end mills, a ball nose, a 118° drill and a chamfer mill.

**Material removal:** the stock is a 0.25 mm height-field (Z-map). Each feed move sweeps the cutter's real profile (flat, ball, drill point or 90° chamfer) along the segment. Cut surfaces turn bright and smooth and carry tool-mark shading. Raw stock keeps a matte mill finish.

**Controller UI:**
- position readout in work, machine or distance-to-go coordinates
- spindle RPM and load bar
- live feed rate, feed override and rapid override
- active modal codes
- syntax-highlighted program listing that follows the running line
- tool table, cycle time and time remaining
- cycle start, feed hold, single block and reset
- simulation speed from 1× to 60×
- five camera presets
- toggles for coolant, chips, toolpath overlay, ambient occlusion and procedural sound

### Keyboard

| Key | Action |
|---|---|
| Space | Cycle start / feed hold |
| R | Reset |
| B | Single block |
| C / P / M | Coolant / toolpath / sound |
| 1–3 | Select program (when not running) |

## Code map

- `src/main.js` sets up the scene, runs the simulation loop and wires up the UI
- `src/machine.js` holds the machine geometry and materials
- `src/tools.js` has the tool library, cutter profiles and procedural cutter and holder meshes
- `src/stock.js` is the height-field stock: carving, normals and GPU updates
- `src/gcode.js` is the G-code interpreter (G0/1/2/3 including helical moves, G81/G83, M6, …)
- `src/programs.js` generates the G-code for the three demo parts
- `src/effects.js` has the chip and coolant particle systems
- `src/audio.js` makes the procedural WebAudio spindle and cutting sound
