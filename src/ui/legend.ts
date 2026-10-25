/** The symbol key, drawn to match the "Pebbles" renderer. */

const orb = (cx: number, cy: number, r: number, id = 'lg-orb') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
const W = 'rgba(255,255,255,0.9)';

const ITEMS: [string, string][] = [
  [`${orb(12, 12, 8)}`, 'Organism: colour is its tag (or family), size is energy'],
  [`${orb(12, 12, 8)}<path d="M8.5 12 H15.5 M13 9.5 L15.5 12 L13 14.5" stroke="${W}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 'Moving (arrow shows the way)'],
  [`<path d="M12 12 L18.5 7.3 A8 8 0 1 0 18.5 16.7 Z" fill="url(#lg-orb)"/><circle cx="20.5" cy="12" r="1.8" fill="#86efac"/>`, 'Eating'],
  [`${orb(12, 12, 8)}<rect x="9.5" y="9.8" width="5" height="5" rx="1.4" stroke="${W}" stroke-width="1.4" fill="none"/>`, 'Picking up food'],
  [`${orb(12, 14, 7)}<circle cx="9.5" cy="4.6" r="1.7" fill="#86efac"/><circle cx="14.5" cy="4.6" r="1.7" fill="#86efac"/>`, 'Carrying food (one berry per unit)'],
  [`${orb(5, 12, 4.5)}${orb(19.5, 12, 3.6)}<circle cx="19.5" cy="12" r="4.8" fill="none" stroke="#fcd877" stroke-width="1"/><path d="M9.5 12 H13" stroke="#fcd877" stroke-width="1.6" stroke-linecap="round"/><path d="M15.4 12 L12.6 9.8 L12.6 14.2 Z" fill="#fcd877"/>`, 'Giving food'],
  [`${orb(12, 12, 8)}<circle cx="12" cy="12" r="1.7" fill="${W}" fill-opacity="0.75"/>`, 'Resting'],
  [`${orb(12, 12, 5)}<circle cx="12" cy="12" r="7.5" fill="none" stroke="hsla(95,90%,75%,0.6)" stroke-width="1.2"/><circle cx="12" cy="12" r="10.5" fill="none" stroke="hsla(95,90%,75%,0.3)" stroke-width="1.2"/>`, 'Signalling (rings in its own colour)'],
  [`${orb(12, 12, 8)}<path d="M16 8.5 V15.5" stroke="${W}" stroke-width="1.9" stroke-linecap="round"/>`, 'Blocked (bar on the side it pushed)'],
  [`${orb(5, 12, 4.5)}<path d="M9 12 H15" stroke="rgba(255,255,255,0.6)" stroke-dasharray="2 2"/>${orb(19, 12, 3)}<circle cx="19" cy="12" r="4.6" fill="none" stroke="#fff" stroke-width="0.9"/>`, 'Birth (line to the newborn, which gets a ring)'],
  [`${orb(12, 12, 5.5)}<circle cx="12" cy="12" r="8.6" fill="none" stroke="rgba(248,113,113,0.92)" stroke-width="1.2" stroke-dasharray="2 2"/>`, 'Starving (under a quarter energy)'],
  [`<circle cx="12" cy="12" r="10" fill="rgba(134,239,172,0.16)"/><g fill="#86efac"><circle cx="13.5" cy="13.5" r="2.5"/><circle cx="9" cy="12.5" r="2.5"/><circle cx="12" cy="8.5" r="2.5"/><circle cx="15.6" cy="9.5" r="2.5"/></g>`, 'Food (more berries = more stock)'],
  [`<ellipse cx="16.8" cy="13.5" rx="5.5" ry="3.8" transform="rotate(17 16.8 13.5)" fill="hsla(90,55%,38%,0.85)"/><ellipse cx="12.1" cy="17.0" rx="5.5" ry="3.8" transform="rotate(89 12.1 17.0)" fill="hsla(90,55%,38%,0.85)"/><ellipse cx="7.3" cy="13.6" rx="5.5" ry="3.8" transform="rotate(161 7.3 13.6)" fill="hsla(90,55%,38%,0.85)"/><ellipse cx="9.0" cy="8.0" rx="5.5" ry="3.8" transform="rotate(233 9.0 8.0)" fill="hsla(90,55%,38%,0.85)"/><ellipse cx="14.9" cy="7.9" rx="5.5" ry="3.8" transform="rotate(305 14.9 7.9)" fill="hsla(90,55%,38%,0.85)"/><g fill="#86efac"><circle cx="13.5" cy="13.5" r="2"/><circle cx="10" cy="11" r="2"/></g>`, 'Plant (with plants on): leaf colour is its strategy (yellow-green fast growers, blue-green root-heavy), berries are edible units'],
  [`<ellipse cx="16.8" cy="13.5" rx="5.5" ry="3.8" transform="rotate(17 16.8 13.5)" fill="hsla(130,12%,45%,0.85)"/><ellipse cx="12.1" cy="17.0" rx="5.5" ry="3.8" transform="rotate(89 12.1 17.0)" fill="hsla(130,12%,45%,0.85)"/><ellipse cx="7.3" cy="13.6" rx="5.5" ry="3.8" transform="rotate(161 7.3 13.6)" fill="hsla(130,12%,45%,0.85)"/><ellipse cx="9.0" cy="8.0" rx="5.5" ry="3.8" transform="rotate(233 9.0 8.0)" fill="hsla(130,12%,45%,0.85)"/><ellipse cx="14.9" cy="7.9" rx="5.5" ry="3.8" transform="rotate(305 14.9 7.9)" fill="hsla(130,12%,45%,0.85)"/>`, 'Plant dormant through a lean season'],
  [`<circle cx="12" cy="12" r="3" fill="hsla(100,55%,38%,0.85)"/>`, 'Seedling (nothing to eat yet)'],
  [`<rect x="3" y="3" width="18" height="18" rx="5" fill="#2b3542"/>`, 'Rock'],
  [`<circle cx="12" cy="12" r="11" fill="url(#lg-plenty)"/>`, 'Fertile region'],
  [`<circle cx="12" cy="12" r="11" fill="url(#lg-lean)"/>`, 'Region in its lean season'],
  [`<rect x="1" y="3" width="22" height="18" rx="4" fill="#2a2418"/>`, 'Whole world lean (warm background)'],
];

export const LEGEND_HTML = `
  <details class="legend">
    <summary>What the symbols mean</summary>
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        <radialGradient id="lg-orb" cx="0.32" cy="0.32" r="0.75">
          <stop offset="0" stop-color="hsl(95,90%,74%)"/><stop offset="1" stop-color="hsl(95,70%,46%)"/>
        </radialGradient>
        <radialGradient id="lg-plenty"><stop offset="0" stop-color="rgba(110,231,183,0.6)"/><stop offset="1" stop-color="rgba(110,231,183,0)"/></radialGradient>
        <radialGradient id="lg-lean"><stop offset="0" stop-color="rgba(217,160,80,0.75)"/><stop offset="1" stop-color="rgba(217,160,80,0)"/></radialGradient>
      </defs>
    </svg>
    <ul class="legend-grid">
      ${ITEMS.map(([svg, label]) => `<li><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${svg}</svg>${label}</li>`).join('')}
    </ul>
    <p class="legend-note">Symbols show what each organism did last tick. At full view organisms are plain dots; zoom in (2× or more) to see the symbols.</p>
  </details>
`;
