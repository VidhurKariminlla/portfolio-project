/* Profile and project content. The only file most edits need to touch.
   No I/O: everything is inline so the site also works from file://. */
(function () {
  'use strict';

  // Small seeded PRNG so generated cover art is identical on every load.
  function rng(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function star(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(' ')}"/>`;
  }

  // n colony dots spread evenly over the ring between `inner` and `outer`.
  function colonies(seed, cx, cy, inner, outer, n) {
    const rand = rng(seed);
    let out = '';
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner));
      const r = 0.8 + rand() * 2.2;
      out += `<circle cx="${(cx + d * Math.cos(a)).toFixed(1)}" cy="${(cy + d * Math.sin(a)).toFixed(1)}" r="${r.toFixed(1)}"/>`;
    }
    return out;
  }

  const SVG_OPEN =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">';

  // Every thumb takes a per-instance uid so gradient/pattern ids never collide.
  function insightloopThumb(uid) {
    return `${SVG_OPEN}
      <defs><linearGradient id="il-bg-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#16324f"/><stop offset="1" stop-color="#2a6f97"/></linearGradient></defs>
      <rect width="320" height="180" fill="url(#il-bg-${uid})"/>
      <rect x="34" y="30" width="168" height="58" rx="6" fill="#fff"/>
      <circle cx="52" cy="48" r="9" fill="#f4a261"/>
      <rect x="68" y="42" width="60" height="5" rx="2.5" fill="#1d3557"/>
      <g fill="#f6c343">${star(72, 57, 5)}${star(84, 57, 5)}${star(96, 57, 5)}${star(108, 57, 5)}</g>
      <g fill="#d5dbe3">${star(120, 57, 5)}</g>
      <rect x="46" y="68" width="140" height="4" rx="2" fill="#c9d3de"/>
      <rect x="46" y="76" width="104" height="4" rx="2" fill="#c9d3de"/>
      <path d="M118 100h160a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H136l-10 9v-9h-8a6 6 0 0 1-6-6v-34a6 6 0 0 1 6-6z" fill="#7fdbca"/>
      <rect x="128" y="112" width="130" height="5" rx="2.5" fill="#0f3d3e" opacity=".7"/>
      <rect x="128" y="122" width="144" height="5" rx="2.5" fill="#0f3d3e" opacity=".45"/>
      <rect x="128" y="132" width="96" height="5" rx="2.5" fill="#0f3d3e" opacity=".45"/>
      <polyline points="226,64 240,54 252,58 266,42 280,46 292,30" fill="none" stroke="#7fdbca"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="292" cy="30" r="4" fill="#fff"/>
    </svg>`;
  }

  function astThumb(uid) {
    return `${SVG_OPEN}
      <defs>
        <radialGradient id="agar-${uid}"><stop offset="0" stop-color="#3b2a12"/><stop offset="1" stop-color="#1b1309"/></radialGradient>
        <filter id="glow-${uid}" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <rect width="320" height="180" fill="#07090c"/>
      <g fill="#fff6dc">
        <rect x="24" y="10" width="272" height="7" rx="3" filter="url(#glow-${uid})"/>
        <rect x="24" y="163" width="272" height="7" rx="3" filter="url(#glow-${uid})"/>
        <rect x="24" y="12" width="272" height="3" rx="1.5"/>
        <rect x="24" y="165" width="272" height="3" rx="1.5"/>
      </g>
      <g fill="#fff6dc" opacity=".05">
        <path d="M24 15h272l-40 60H64z"/><path d="M24 165h272l-40-60H64z"/>
      </g>
      <circle cx="100" cy="90" r="60" fill="#14181e" stroke="#4a5563" stroke-width="2"/>
      <circle cx="220" cy="90" r="60" fill="#14181e" stroke="#4a5563" stroke-width="2"/>
      <circle cx="100" cy="90" r="53" fill="url(#agar-${uid})"/>
      <circle cx="220" cy="90" r="53" fill="url(#agar-${uid})"/>
      <g fill="#f2e6c2">${colonies(7, 100, 90, 27, 51, 90)}${colonies(11, 220, 90, 10, 51, 160)}</g>
      <circle cx="100" cy="90" r="7" fill="#f5f5f0"/>
      <circle cx="220" cy="90" r="7" fill="#f5f5f0"/>
      <g font-family="Geneva, Verdana, sans-serif" font-size="11" font-weight="bold" fill="#8796a8">
        <text x="40" y="40">S</text><text x="273" y="40">R</text>
      </g>
    </svg>`;
  }

  function housePiesThumb(uid) {
    let lattice = '';
    for (let i = -3; i <= 3; i++) {
      lattice += `<rect x="${118 + i * 16}" y="30" width="8" height="124"/>`;
    }
    return `${SVG_OPEN}
      <defs>
        <pattern id="ging-${uid}" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#fbf3e4"/>
          <rect width="12" height="24" fill="#d94b3d" opacity=".3"/>
          <rect width="24" height="12" fill="#d94b3d" opacity=".3"/>
        </pattern>
        <clipPath id="fill-${uid}"><circle cx="122" cy="92" r="52"/></clipPath>
      </defs>
      <rect width="320" height="180" fill="url(#ging-${uid})"/>
      <ellipse cx="126" cy="100" rx="70" ry="68" fill="#000" opacity=".12"/>
      <circle cx="122" cy="92" r="67" fill="#fff" stroke="#e6dccb" stroke-width="2"/>
      <circle cx="122" cy="92" r="60" fill="#d39448" stroke="#9a5f25" stroke-width="2"/>
      <circle cx="122" cy="92" r="52" fill="#9e2a2b"/>
      <g clip-path="url(#fill-${uid})" fill="#e7b066" stroke="#9a5f25" stroke-width="1.5">
        <g transform="rotate(45 122 92)">${lattice}</g>
        <g transform="rotate(-45 122 92)">${lattice}</g>
      </g>
      <path d="M214 26h78v124l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5z"
        fill="#fff" stroke="#d8cfbf"/>
      <rect x="226" y="38" width="44" height="6" fill="#3b2f2f"/>
      <g fill="#b9ad9c">
        <rect x="226" y="58" width="34" height="3"/><rect x="272" y="58" width="10" height="3"/>
        <rect x="226" y="70" width="28" height="3"/><rect x="272" y="70" width="10" height="3"/>
        <rect x="226" y="82" width="38" height="3"/><rect x="272" y="82" width="10" height="3"/>
        <rect x="226" y="94" width="24" height="3"/><rect x="272" y="94" width="10" height="3"/>
      </g>
      <rect x="226" y="110" width="56" height="1" fill="#3b2f2f"/>
      <rect x="226" y="118" width="26" height="5" fill="#3b2f2f"/><rect x="266" y="118" width="16" height="5" fill="#9e2a2b"/>
    </svg>`;
  }

  function siteThumb(uid) {
    return `${SVG_OPEN}
      <defs>
        <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1f2d55"/><stop offset=".45" stop-color="#7a5b9a"/><stop offset=".8" stop-color="#ef9a8a"/><stop offset="1" stop-color="#ffd3a1"/>
        </linearGradient>
        <filter id="sh-${uid}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-opacity=".35"/></filter>
      </defs>
      <rect width="320" height="180" fill="url(#sky-${uid})"/>
      <path d="M0 112c40-18 80-26 120-18s80 26 120 12 60-24 80-22v96H0z" fill="#7d64a8"/>
      <path d="M0 132c50-14 100-4 150-8s110-26 170-14v70H0z" fill="#46397c"/>
      <text x="160" y="150" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="46" font-weight="800" fill="#ffe9da" fill-opacity=".85">VIDHUR</text>
      <path d="M0 150c60-16 120-8 180 0s100 6 140-4v34H0z" fill="#221f4d"/>
      <rect width="320" height="9" fill="#000" fill-opacity=".22"/>
      <g filter="url(#sh-${uid})">
        <rect x="70" y="22" width="180" height="108" rx="9" fill="#fff"/>
      </g>
      <path d="M70 31a9 9 0 0 1 9-9h33v108H79a9 9 0 0 1-9-9z" fill="#ececf1"/>
      <circle cx="80" cy="32" r="2.6" fill="#ff5f57"/><circle cx="88" cy="32" r="2.6" fill="#febc2e"/><circle cx="96" cy="32" r="2.6" fill="#28c840"/>
      <g fill="#c7c9d1"><rect x="78" y="46" width="26" height="3" rx="1.5"/><rect x="78" y="54" width="22" height="3" rx="1.5"/><rect x="78" y="62" width="24" height="3" rx="1.5"/></g>
      <g><rect x="120" y="44" width="58" height="36" rx="4" fill="#2a6f97"/><rect x="184" y="44" width="58" height="36" rx="4" fill="#14181e"/>
        <rect x="120" y="88" width="58" height="36" rx="4" fill="#e7b066"/><rect x="184" y="88" width="58" height="36" rx="4" fill="#7a5b9a"/></g>
      <rect x="112" y="156" width="96" height="18" rx="7" fill="#fff" fill-opacity=".32"/>
      <g><rect x="118" y="159" width="12" height="12" rx="3" fill="#1f7cf2"/><rect x="134" y="159" width="12" height="12" rx="3" fill="#5b3fd6"/>
        <rect x="150" y="159" width="12" height="12" rx="3" fill="#fff"/><rect x="166" y="159" width="12" height="12" rx="3" fill="#ff5a5f"/>
        <rect x="182" y="159" width="12" height="12" rx="3" fill="#2c2c2e"/></g>
    </svg>`;
  }

  const profile = Object.freeze({
    name: 'Vidhur Kariminlla',
    role: 'Student developer: web apps and lab hardware',
    currently: 'Rebuilding InsightLoop',
    // Fill these in to show them in Contact, About and the resume. Empty values are hidden.
    email: '',
    github: '',
    linkedin: '',
    site: 'https://insight-loop.co',
    about: Object.freeze([
      'I build software people actually use and hardware that has to survive a lab. Right now that mostly means InsightLoop, a review-management product for local businesses that I am rebuilding from scratch at insight-loop.co.',
      'Alongside it I do science research and competitions: a darkfield imaging enclosure for a team project on antibiotic susceptibility testing, a restaurant ordering app for FBLA, and a NASA TechRise balloon proposal.',
      'I like writing things down: decision records, honest limitations, plain-English guides to my own code. A project you can explain is a project you understand.',
    ]),
    // `weight` (1-5) only sets the bar length in About This Computer.
    skills: Object.freeze([
      { name: 'TypeScript & React', where: 'InsightLoop', weight: 5 },
      { name: 'Next.js', where: 'InsightLoop', weight: 4 },
      { name: 'Vanilla JavaScript', where: 'House of Pies, this site', weight: 4 },
      { name: 'CSS & design systems', where: 'InsightLoop, this site', weight: 4 },
      { name: 'Postgres & Supabase', where: 'InsightLoop backend', weight: 3 },
      { name: 'Fusion 360 CAD', where: 'AST enclosure', weight: 3 },
      { name: 'Experimental design', where: 'Science research', weight: 3 },
      { name: 'Technical writing', where: 'ADRs, code guides', weight: 4 },
    ]),
    activities: Object.freeze([
      'FBLA: competition web app (House of Pies)',
      'Science research: team project on antibiotic susceptibility testing (ISEF track)',
      'NASA TechRise: high-altitude balloon experiment proposal, in progress',
    ]),
  });

  const filters = Object.freeze([
    { id: 'all', label: 'All projects' },
    { id: 'software', label: 'Software' },
    { id: 'hardware', label: 'Hardware' },
  ]);

  const projects = Object.freeze([
    {
      id: 'insightloop',
      title: 'InsightLoop',
      tagline: 'Review management for local businesses: AI-drafted replies, urgent-review alerts, sentiment over time.',
      category: 'software',
      badge: 'LIVE',
      meta: 'Next.js / TypeScript / Supabase',
      kind: 'Web app',
      size: '165 commits',
      date: '2026-10-25',
      url: 'https://insight-loop.co',
      repo: '',
      thumb: insightloopThumb,
      summary: [
        'InsightLoop watches a local business’s review listings, drafts on-brand replies in the reviewer’s own language, escalates urgent negatives, and tracks sentiment and recurring themes over time. It is built for the one-to-three-location owner-operator who is rarely at a desk, not for agencies.',
        'This is a from-scratch rebuild. The public marketing site is live at insight-loop.co. The backend and dashboard (Google sign-in, Postgres with row-level security, a server-only data-access layer) are being built in the same Next.js app on a branch.',
        'One product decision shaped a lot of the design: the direct-to-owner feedback channel is offered to every customer on identical terms, never reordered or hidden based on star rating. Google forbids sentiment-gated review funnels and the penalty lands on the business’s own profile, so symmetry is both the rule and the sales argument.',
      ],
      features: [
        'Live marketing site: home, how it works, pricing, booking, contact and city pages',
        '15 architecture decision records, from “no separate backend service” to rate limiting with Upstash',
        'Database schema as 12 versioned migrations, with security tests run against an in-memory Postgres',
        'Design-system rules enforced on every edit: no raw hex, no off-system fonts, contract-checked props',
        'One verify command (types, lint, design system, unit tests, database tests) runs before every push',
        'Change log generated from git history, with a check that fails if it drifts',
      ],
      stack: ['Next.js 16', 'React 19', 'TypeScript', 'Tailwind CSS v4', 'Radix / shadcn', 'Supabase', 'Postgres RLS', 'Vercel'],
      notes:
        'The dashboard is not live yet. Sign-in, the database and its security rules exist on the backend branch, but review ingestion, AI replies and billing are still being built. The repository is private, so there is no public code to browse; the live site is the thing to look at.',
    },
    {
      id: 'ast-enclosure',
      title: 'AST Imaging Enclosure',
      tagline: 'A 3D-printed darkfield enclosure that lets a phone photograph bacterial growth on agar plates inside an incubator.',
      category: 'hardware',
      badge: 'RESEARCH',
      meta: 'Fusion 360 / Experimental design',
      kind: 'Lab hardware',
      size: 'Version 13',
      date: '2026-10-21',
      url: '',
      repo: '',
      thumb: astThumb,
      summary: [
        'Part of a team science research project on antibiotic susceptibility testing. Two agar plates sit side by side in an enclosure inside a 35 °C incubator, and a phone above them takes images at locked settings so growth on the susceptible and resistant plates can be compared over time.',
        'Darkfield lighting is the hard part. LED strips run along the front and back walls in recessed channels tilted 18° downward, so light grazes the agar at 15–20° and colonies scatter it toward the camera, while a 10 mm recess and a ledge keep the LEDs out of the camera’s direct view.',
        'My most recent session redesigned the LED channels around the strip we actually chose, a 5000K, CRI 90+ COB strip, and documented every change, measurement and open risk so the rest of the team could check the work.',
      ],
      features: [
        'Channels narrowed from 15 mm to 9 mm to fit the 8 mm strip, with depth and tilt kept fixed to preserve glare shielding',
        'Left ends of both channels filled and re-cut, giving the strip one continuous mounting face from end to end',
        'Wire exits enlarged to 12 mm, mirrored front to back, routed through one side wall only',
        'Modeled grazing angles across each plate: both strips meet the plate center at exactly 18°',
        'Pre-registered checks: blank-plate brightness profiles, a slot-swap control, a condensation check and a fixed analysis area',
      ],
      stack: ['Fusion 360', 'Parametric CAD', '3D printing', 'COB LED lighting', 'Darkfield imaging', 'Experimental design'],
      notes:
        'Heat is the biggest open risk: about 2.7 W of LED heat sits 20 mm above the agar in a closed box at 35 °C, which could warm plate edges unevenly and push the phone past its operating limit. The strip also needs 12 V where the plan assumed 5 V USB, brightness falls off near the strip ends, and the angle figures are model measurements still waiting on a blank-plate photo to confirm them.',
    },
    {
      id: 'house-of-pies',
      title: 'House of Pies',
      tagline: 'A restaurant ordering web app for FBLA: menu, cart, checkout, order history and a spending tracker, in plain JavaScript.',
      category: 'software',
      badge: 'FBLA',
      meta: 'Vanilla JavaScript / ES modules',
      kind: 'Web app',
      size: '—',
      date: '2026-10-12',
      url: '',
      repo: '',
      thumb: housePiesThumb,
      summary: [
        'A competition web app for FBLA 2027. Customers pick a restaurant location, browse the menu, build a cart, check out, and look back at past orders and their spending against a limit they set.',
        'It is plain JavaScript modules with no framework. A small router maps addresses like #/cart to screens, a store holds the whole app state and saves it in the browser, and every screen is redrawn from that state instead of patched in place, which is why the Back button and the cart badge always agree.',
        'Judges ask how the code works, so I wrote a line-by-line, plain-English guide to the entry point, with the code on the left and a note beside every line.',
      ],
      features: [
        'Hash-based router: every screen has its own address, so Back and Forward work',
        'A single state store with subscribe-and-redraw; no screen updates itself piece by piece',
        'Seeded with 90 days of generated orders so history and spending have something to show',
        'Stock checks in the action layer before anything reaches the cart',
        'Spending screen with a self-set limit, a help assistant and a first-visit tour',
        'Keyboard focus management and ARIA labelling for screen-reader users',
        'Warns when the browser will not save data and falls back to temporary storage',
      ],
      stack: ['JavaScript', 'ES modules', 'HTML', 'CSS', 'localStorage', 'Accessibility'],
      notes:
        'Everything lives in the browser. There is no server, so orders do not sync between devices, and the 90 days of history are generated rather than real. It demonstrates an ordering flow for judges; it does not take real payments.',
    },
    {
      id: 'vidhur-os',
      title: 'Vidhur OS',
      tagline: 'This site: a portfolio dressed as a modern macOS-style desktop, with no framework and no build step.',
      category: 'software',
      badge: 'NEW',
      meta: 'HTML / CSS / JavaScript',
      kind: 'Website',
      size: '~15,000 lines',
      date: '2026-10-25',
      url: '',
      repo: '',
      thumb: siteThumb,
      summary: [
        'You are using it. The site boots to a lock screen, then presents each project in a Finder-style gallery inside a real window manager, with a Dock for switching between apps. It is plain HTML, CSS and classic script tags: no framework, no bundler, no dependencies, and it works opened straight from the filesystem.',
        'Every icon and piece of cover art, including the wallpaper with my name set into the hills, is drawn in SVG and CSS, and every sound is synthesised at runtime with the Web Audio API. There are no Apple system assets in it: the look is redrawn from scratch.',
      ],
      features: [
        'Window manager with drag, resizing from any edge, zoom, and minimize-to-Dock with per-window Back and Forward',
        'Spotlight, Launchpad, Notification Center, Control Center, right-click menus and System Settings with a wallpaper picker',
        'Blockcraft: a voxel sandbox written in raw WebGL with procedurally painted textures, saving and touch controls',
        'A Music app whose nine original songs are synthesised live by a small Web Audio sequencer',
        'Notes with checklists and autosave, a Calculator, and a Terminal with a virtual file system',
        'An iPhone-style home screen on phones, and light and dark appearances',
      ],
      stack: ['HTML', 'CSS', 'JavaScript', 'SVG', 'Web Audio API'],
      notes:
        'It is a costume, not an operating system: there are no real files, and the system font only matches macOS on a Mac. On a phone every window opens full-screen and the Dock shrinks, which is practical but less fun.',
    },
  ].map(Object.freeze));

  window.MacData = Object.freeze({ profile, filters, projects });
})();
