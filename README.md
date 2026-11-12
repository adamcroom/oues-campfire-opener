# OUES Campfire Opener

A click-through opening visual for the OUES Board and Team Luncheon. It starts in the stars, comes down through the U.S., Oklahoma, Norman and the OUES office, sweeps to Beavers Bend State Park and lands on a campfire that stays up behind the hosts.

Plain HTML, CSS and JavaScript. No build step, no framework, no API keys.

## Run it

Open the hosted copy at <https://adamcroom.github.io/oues-campfire-opener/>, or double-click `index.html` in a downloaded copy and it opens in your browser. Use Chrome or Edge. Either way the laptop needs to be online: the map imagery, the map library and the font all load from the web.

The hosted copy updates a minute or two after each push to the `main` branch.

Serving the folder works too, if you prefer (`npx serve .` or `python3 -m http.server 8000`, then open the address it prints).

If the screen stays black with a "did not start" note, the scripts did not load: check the connection and reload.

### Before the audience arrives

1. Open the page on the presentation laptop, on the venue Wi-Fi.
2. Press **F** for full screen. Do this first: the preload is sized to the window, so it starts over when the window changes size.
3. Press **N** and wait for the green **Ready** dot. It took just under a minute in testing; keep the tab in front while it works (browsers pause background tabs). Press **N** again to hide the notes.
4. For a belt-and-braces run, click through the whole sequence once, then press **R**. Anything fetched during that rehearsal stays in memory for the real thing.
5. Leave it on the stars. Click when it is time to start.

If the dot is amber ("Preload interrupted" or "some imagery was slow"), press **R** and wait again. The show still runs without a green dot; you just risk seeing imagery sharpen during a move.

## Controls

| Action | Keys / input |
|---|---|
| Next build or step | Right Arrow, Space, Page Down, Down Arrow, mouse click (not on a link) |
| Previous build or step | Left Arrow, Page Up, Up Arrow |
| Reset to stars | R |
| Full screen | F |
| Presenter notes | N |
| Title on the stars ("Pull up a chair.") | T |
| Fire sound (off by default) | S |
| Jump to a step | 0 to 6 |

- Presentation clickers send Page Down and Page Up. Both are handled.
- A click during a camera move finishes that move at once and shows its text. Moves are never queued.
- Two presses within a fifth of a second count as one, so a bouncy clicker cannot skip a move.
- Number keys and R cut cleanly (a short fade) instead of flying.
- The mouse pointer hides after two seconds without movement.
- F5 is ignored, because the "start slideshow" button on many clickers sends it and a reload would drop the room back at the stars. Use Ctrl+R (Cmd+R on a Mac) to reload on purpose.

## How the steps play

| Step | Scene | Clicks |
|---|---|---|
| 0 Stars | Walk-in starfield, loops as long as you like | 1 click starts the descent |
| 1 The United States | Night lights on the globe | Headline appears when the camera settles |
| 2 Oklahoma | Outline glows, the rest dims | 3 statements, one per click |
| 3 Norman | Dusk satellite view of OU's main campus | 2 statements (a third is switched off, see below) |
| 4 Three Partners Place | A short hop south to the research campus; pin drops on the office | Headline, then the thesis line |
| 5 Beavers Bend | Lift, sweep southeast, descend; firelight glows; crossfade to the fire; "Pull up a chair." | Plays on its own from one click |
| 6 Campfire | Clean fire scene behind the hosts | Nothing to click |

Going back from the campfire (Left Arrow) returns to Beavers Bend on the map. Right Arrow from there lights the fire again.

## Editing content

**Everything editable is in [`content.js`](content.js).** Text, sources, coordinates, camera framing and timing all live in the one `CONTENT` object. Save and reload the page.

### Text and sources

Each step has a `builds` list. Each build has:

- `role`: `"headline"`, `"secondary"` or `"thesis"` (the thesis is a little larger and warmer)
- `text`: the statement, shown exactly as written
- `source` (optional): `{ label, url }`. It appears as `Source: label` under the statement and opens the URL in a new tab.
- `enabled: false` (optional): keeps the line in the file but off the screen

No more than three statements are ever on screen. If a step has four, the oldest drops away when the fourth appears.

`notes` on each step is the text in the presenter notes panel.

### Coordinates

Coordinates are `[longitude, latitude]`, longitude first, west negative. That is the reverse of how Google Maps shows them.

The three places are named constants at the top of `content.js`:

- `OU_CAMPUS` is where Step 3 lands: OU's main campus, between Bizzell Memorial Library and the stadium.
- `OFFICE` is the pin in Step 4: Three Partners Place, 201 David L. Boren Blvd, set to `[-97.438134, 35.183729]` (the center of the building OpenStreetMap maps at that address). If the pin should sit on a different part of the building, right-click the spot in Google Maps, copy the coordinates, and swap their order.
- `BEAVERS_BEND` is where Step 5 ends.

Beavers Bend is set to `[-94.6899, 34.1312]`, which matches the park's location in OpenStreetMap.

### The optional NC-SARA line

Step 3 has a third statement that is switched off. To use it, replace `[NUMBER]` with a confirmed public figure and change `enabled: false` to `enabled: true`.

### Camera and timing

Each map step has a `camera`:

- `center`, `zoom`, `pitch`, `bearing`: where the move ends. The numbers are tuned for a 1920x1080 frame; other window sizes are compensated automatically so the framing stays the same.
- `duration`: length of the move into that step, in milliseconds.
- `padding`: fraction of the screen kept clear on a side. `bottom: 0.4` lifts the subject above the text panel.
- `via` (Beavers Bend only): the zoom and pitch at the top of the arc.

`CONTENT.timing` holds the shared timings: the pause before text, how long the firelight glows before the fire appears, the crossfade length, and how long "Pull up a chair." stays up.

`CONTENT.campfire.embers` sets the number of embers.

## If it looks choppy over Teams

Try these in order, all in `content.js`:

1. Raise each step's `duration` by 30 to 50 percent.
2. Lower `campfire.embers` (for example to 16).
3. Set `map.projection` to `"mercator"`. The Earth is then drawn flat instead of as a globe, which is lighter on the laptop.

## Map imagery

| Steps | Source | Credit shown on screen |
|---|---|---|
| U.S., Oklahoma | NASA GIBS, VIIRS Black Marble (2016) | Imagery: NASA EOSDIS GIBS, VIIRS Black Marble. |
| Norman, office, Beavers Bend | Esri World Imagery | Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community. |

Both URL templates from the spec were checked on Nov-10-26 and work unchanged. They are at the top of [`map.js`](map.js). The credit sits in the bottom-right corner whenever the map is visible and fades out with it at the campfire.

Satellite fades in over the night lights between zoom 7 and 8.6, so Black Marble (which stops at zoom 8) is never stretched. The close-ups get a dusk treatment (dimmer, less saturated, slightly cool) set in `CONTENT.map.dusk`.

The Oklahoma outline is in [`oklahoma.js`](oklahoma.js). It was derived once from the `us-atlas` state boundaries (U.S. Census Bureau, public domain) and is shipped with the project, so it does not depend on the network.

MapLibre GL JS is pinned to **5.24.0** from unpkg. Version 6 exists, but it dropped the plain script build and is still changing quickly, so the last v5 release is the safer choice for a live event.

## Reliability

- **Preloading.** While the stars are up, the hidden map visits every step's end position and frames along every flight path, and waits for the imagery at each one. Every tile's bytes are then held in memory until the page is reloaded, so live moves draw almost entirely from memory. A small number of in-between tiles are still fetched during a move; they arrive under the coarse imagery described next. (NASA's server tells browsers not to cache its tiles, which is why the page keeps its own copy.)
- **No dark gaps on pull-backs.** Coarse copies of the imagery sit underneath the sharp layer, so there is always a picture at the edges when the camera lifts quickly.
- **If imagery fails.** If satellite tiles cannot be loaded, the close-up steps stay at state level with the Oklahoma outline and the pin. If night tiles cannot be loaded, the outline shows on a dark map. If MapLibre or WebGL is unavailable, the text, stars and campfire still run. The notes panel says which of these has happened. Add `?map=off` to the address to rehearse the last case.
- **No accidental map moves.** Dragging, scrolling and rotating are disabled.
- **Smooth dark skies in every browser.** The Milky Way is worked out in floating point and rounded to screen colour once, with a little dither, and the campfire stills carry a whisper of grain. Without that, Chrome shows a woven texture and contour rings in the dark gradients that Safari hides.
- **Long holds.** The starfield and campfire redraw from fixed-size buffers and allocate nothing per frame, so memory stays flat. Both draw at about 30 frames a second.

## Reduced motion

If the computer has "reduce motion" switched on (on Windows: Settings, Accessibility, Visual effects, Animation effects off), camera flights become gentle crossfades between end states, the starfield stops drifting, and the fire and embers move less.

**Check this on the presentation laptop.** If the notes panel says "Reduced motion is on" and you want the full flights, add `?motion=full` to the address, or set `motion: "full"` in `content.js`. `?motion=reduced` forces the calm version.

## Sound

Off by default. **S** turns on a fire crackle that is synthesized in the browser with the Web Audio API, so there is no audio file and nothing to license. It is only audible while the campfire is on screen. Audio over Teams is unpredictable, so treat it as an in-room extra.

## Choices made where the spec left room

- **Plain scripts, not ES modules.** Browsers refuse to load modules from a file on disk, which left a black screen on a double-click. The files are now ordinary scripts loaded in order by `index.html`, so no local server is needed.
- **Files are at the top of this folder** rather than in a nested `oues-campfire-opener/` folder. Two files were added to the suggested structure: `oklahoma.js` (the outline) and `fire-audio.js` (the synthesized crackle). There is no `audio/` folder because no audio file is used.
- **Letterboxing.** The stars, map and campfire fill the whole window. All text, including the imagery credit, stays inside a centered 16:9 safe area and scales with it. Only the presenter notes sit in the window corner.
- **The globe.** Step 1 shows the Earth as a sphere with the starfield still visible around it, instead of a flat map fading in.
- **Steps 5 and 6.** One click plays all of Step 5. "Pull up a chair." then holds for seven seconds (`timing.titleHold`) and fades, which is the move to Step 6. A click during the hold fades it straight away.
- **First statement.** The first line of each step appears on its own once the camera settles; later lines need a click.
- **Oklahoma framing.** Zoom is 5.9 rather than 6.2 so the whole state stays clear of the text panel when all three statements are up.
- **Shooting stars.** One faint streak every two to four minutes on the walk-in starfield. Set `campfire.shootingStars` to `false` to turn them off.
- **Font.** Manrope, from Google Fonts.

## Files

```
index.html      page shell and the stacked layers
styles.css      typography, text panel, source lines, pin, notes panel
content.js      ALL editable text, sources, coordinates and timing
app.js          step engine, keyboard and clicker handling, transitions, notes
map.js          MapLibre setup, tile sources, camera paths, preloading
starfield.js    walk-in starfield
campfire.js     campfire scene
fire-audio.js   optional synthesized fire crackle
oklahoma.js     Oklahoma outline
```

The original brief (`SPEC.md`) is kept out of the repository; it is listed in `.gitignore`.

## Before the event

- [ ] Confirm the Step 4 pin sits on Three Partners Place (press **4**). Adjust `OFFICE` in `content.js` if it should move.
- [ ] Confirm the Beavers Bend camera lands over the park (adjust coordinates if needed).
- [ ] Run the full sequence on the actual presentation laptop and projector.
- [ ] Test the clicker (Page Up / Page Down).
- [ ] Check whether the laptop has reduced motion switched on (see above).
- [ ] **Run it over a Teams screen share** with a remote colleague watching. Check that moves look smooth, text is readable, and the campfire does not look choppy.
- [ ] Recheck the statistics the week of the event. The National Student Clearinghouse is due to release new "some college, no credential" figures in November 2026; if they are out, update the Step 2 stopout line.
- [ ] Decide on the NC-SARA out-of-state online line (Step 3, build 3). Enable it only with a confirmed public figure.
