// OUES Campfire Opener: the single place to edit text, sources, coordinates and timing.
// Nothing in here touches animation code. Save the file and reload the page.

// ---------------------------------------------------------------------------
// Coordinates are [longitude, latitude] (MapLibre order): west is negative and
// the LONGITUDE comes first. Google Maps shows them the other way around.
// ---------------------------------------------------------------------------

// OU's main campus in Norman: between Bizzell Memorial Library and the stadium, over the South Oval.
const OU_CAMPUS = [-97.4453, 35.2073];

// Only used as a stand-in if OFFICE below is ever set back to null.
const NORMAN = [-97.44, 35.22];

// Three Partners Place, 201 David L. Boren Blvd, Norman (OU Research Campus).
// From OpenStreetMap: the center of the building mapped at that address.
// Set this to null to fall back to the Norman center (the presenter notes then show a warning).
const OFFICE = [-97.438134, 35.183729];

// Beavers Bend State Park, near Broken Bow (checked against OpenStreetMap: 34.1312, -94.6899).
const BEAVERS_BEND = [-94.6899, 34.1312];

const CONTENT = {
  title: "Pull up a chair.",

  // "auto" follows the computer's reduced-motion setting. "full" or "reduced" forces one.
  // The URL can override this for one session: index.html?motion=full or ?motion=reduced
  motion: "auto",

  timing: {
    textDelay: 250,          // pause after a camera move settles before text appears (ms)
    glowLead: 1500,          // how long the firelight glows on the map before the fire appears (ms)
    campfireCrossfade: 2000, // map to campfire crossfade (ms)
    titleHold: 7000,         // how long "Pull up a chair." stays over the fire before fading (ms)
    backSpeed: 0.8,          // going backward plays each move at this fraction of its duration
    cursorHide: 2000,        // hide the mouse pointer after this long without movement (ms)
  },

  campfire: {
    embers: 34,              // lower this if the fire looks choppy over Teams
    shootingStars: true,     // faint shooting stars on the walk-in starfield (false turns them off)
    shootingStarEvery: [90, 120], // seconds between them: a random wait between these two numbers
  },

  attribution: {
    night: "Imagery: NASA EOSDIS GIBS, VIIRS Black Marble.",
    satellite: "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community.",
  },

  map: {
    // "globe" shows the Earth as a sphere on the way down from the stars.
    // Use "mercator" (flat) if the presentation laptop struggles with it.
    projection: "globe",

    // Where the camera sits, out among the stars, before Step 1 descends.
    orbit: { center: [-58, 16], zoom: 0.8, pitch: 0, bearing: 0 },

    // Dusk treatment for the satellite close-ups: dim, slightly cool, still readable.
    dusk: { brightnessMax: 0.56, brightnessMin: 0.0, saturation: -0.32, contrast: 0.1, hueRotate: 8 },
  },

  // Camera notes:
  //   zoom, pitch and bearing are tuned for a 1920x1080 frame; other screen sizes are
  //   compensated automatically so the framing stays the same.
  //   padding is a fraction of the screen (0 to 1) kept clear on that side. A bottom
  //   padding lifts the subject above the text panel.
  //   duration is the camera move INTO this step, in milliseconds.
  steps: [
    {
      id: "stars",
      name: "Stars",
      scene: "stars",
      camera: null,
      builds: [],
      notes: "Walk-in. Let it run while people get food. Click when ready to start.",
    },
    {
      id: "us",
      name: "The United States",
      scene: "map",
      camera: { center: [-98.35, 39.5], zoom: 3.6, pitch: 10, bearing: 0, duration: 3800, padding: { bottom: 0.2 } },
      basemap: "night",
      builds: [
        {
          role: "headline",
          text: "Across the U.S., the number of high school graduates is projected to fall 13% by 2041.",
          source: { label: "WICHE, Knocking at the College Door (2024)", url: "https://www.wiche.edu/knocking/" },
        },
      ],
      notes: "The national picture: the demographic cliff is real for most of the country.",
    },
    {
      id: "oklahoma",
      name: "Oklahoma",
      scene: "map",
      // Framed high and a touch wide so the whole state stays clear of the three-statement panel.
      camera: { center: [-97.5, 35.5], zoom: 5.9, pitch: 16, bearing: -6, duration: 3300, padding: { bottom: 0.55, left: 0.04 } },
      basemap: "night",
      builds: [
        {
          role: "headline",
          text: "Oklahoma is holding steady: about 46,000 high school graduates a year, projected to stay level through 2041.",
          source: {
            label: "WICHE projections via Texas A&M University System analysis",
            url: "https://www.tamus.edu/data-science/2025/03/01/projecting-the-demographic-cliff-18-year-olds-and-high-school-graduates/",
          },
        },
        {
          role: "secondary",
          text: "But fewer than half of Oklahoma public high school graduates (46.8%) go on to college the year after graduating.",
          source: {
            label: "Oklahoma State Regents, 2024 High School Indicators Report",
            url: "https://okhighered.org/wp-content/uploads/2026/05/hsir2024.pdf",
          },
        },
        {
          role: "secondary",
          text: "And 413,576 Oklahomans started college and stopped without a credential. Re-enrollment among them fell nearly 14% last year, the steepest drop in the country.",
          source: {
            label: "National Student Clearinghouse via KGOU (2026)",
            url: "https://www.kgou.org/education/2026-05-05/oklahoma-falling-behind-40-states-in-getting-college-stopouts-back-to-class",
          },
        },
      ],
      notes: "Oklahoma's front door is steady, but most of the state isn't walking through it. Pause after the stopout line.",
    },
    {
      id: "norman",
      name: "Norman",
      scene: "map",
      // Tight on the main campus rather than the whole city.
      camera: { center: OU_CAMPUS, zoom: 15.5, pitch: 50, bearing: 8, duration: 4200, padding: { bottom: 0.3 } },
      basemap: "satellite",
      builds: [
        {
          role: "headline",
          text: "OU welcomed 6,437 freshmen this fall, the largest class in state history and its sixth straight record. That streak has grown OU's incoming class by 45%.",
          source: {
            label: "OU News, Aug. 2026",
            url: "https://ou.edu/admissions/sooner-stories/2026/ou-continues-historic-momentum-with-largest-freshman-class-in-State-and-University-history-for-sixth-straight-year",
          },
        },
        {
          role: "secondary",
          text: "37% of OU's Oklahoma freshmen are the first in their families to attend college.",
          source: {
            label: "OU Office of the President, Aug. 2026",
            url: "https://ou.edu/president/messages-and-statements/2026/welcome-to-the-fall-2026-semester",
          },
        },
        {
          // Optional line. Replace [NUMBER] with a confirmed public figure, then set enabled: true.
          enabled: false,
          role: "secondary",
          text: "[NUMBER] Oklahomans are earning degrees fully online from schools in other states.",
          source: { label: "NC-SARA data dashboards", url: "https://nc-sara.org/data-dashboards" },
        },
      ],
      notes: "OU is thriving at the front door. Note the first-gen number: these are exactly the students OUES helps serve.",
    },
    {
      id: "office",
      name: "Three Partners Place",
      scene: "map",
      // "via" gives the short hop south from campus a gentle lift before it settles on the office.
      camera: {
        center: OFFICE ?? NORMAN, zoom: 16.8, pitch: 55, bearing: -18, duration: 3600,
        via: { zoom: 14.3, pitch: 40 },
        padding: { bottom: 0.44 },
      },
      placeholder: OFFICE === null,
      pin: true,
      basemap: "satellite",
      builds: [
        {
          role: "headline",
          text: "Oklahoma is moving toward funding universities on outcomes. Under a new formula, a growing share of state funding, rising to 25% of base funding over the next several years, will be tied to student success and workforce results.",
          source: {
            label: "Oklahoma Business Voice, June 2026",
            url: "https://okbusinessvoice.com/2026/06/18/regents-performance-funding-plan-aims-to-align-higher-education-with-workforce-needs/",
          },
        },
        {
          // OUES's own statement: no source line.
          role: "thesis",
          text: "Together with OU, we’re making an OU degree possible for anyone in Oklahoma and beyond who’s ready to start, come back and finish, or advance in their career.",
        },
      ],
      notes: "The rules are changing: the state is moving toward paying for outcomes. Then land the thesis: why OUES exists.",
    },
    {
      id: "beavers",
      name: "Beavers Bend",
      scene: "map",
      // "via" is the top of the arc: the camera lifts to this zoom and pitch, sweeps southeast,
      // then descends. The top padding lines the park up with the campfire, which sits a little
      // below the middle of the frame.
      camera: {
        center: BEAVERS_BEND, zoom: 14.4, pitch: 64, bearing: 16, duration: 5800,
        via: { zoom: 7.6, pitch: 12 },
        padding: { top: 0.28 },
      },
      toCampfire: true, // when the camera settles: firelight glow, crossfade to the fire, then the title
      basemap: "satellite",
      builds: [],
      notes: "Imaginary campfire, real conversations. Let the transition breathe; don't talk over it.",
    },
    {
      id: "campfire",
      name: "Campfire",
      scene: "fire",
      camera: null,
      builds: [],
      notes: "Hand off to Chat 1: Who's missing, and how do we bring them home?",
    },
  ],
};
