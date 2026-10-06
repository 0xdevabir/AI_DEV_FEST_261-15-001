/** Shared TenderNest mark markup (inline SVG). */
let _logoSeq = 0;

export function logoMark({ className = '', size = 36 } = {}) {
  const cls = className ? ` class="${className}"` : '';
  const dim = `width="${size}" height="${size}"`;
  const id = `tn${++_logoSeq}`;
  return `<svg${cls} ${dim} viewBox="0 0 64 64" role="img" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${id}-tile" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
      <stop stop-color="#3A3A3C"/><stop offset="1" stop-color="#1D1D1F"/>
    </linearGradient>
    <linearGradient id="${id}-paper" x1="20" y1="18" x2="44" y2="40" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFFDF9"/><stop offset="1" stop-color="#E8E4DA"/>
    </linearGradient>
    <linearGradient id="${id}-nest" x1="32" y1="34" x2="32" y2="54" gradientUnits="userSpaceOnUse">
      <stop stop-color="#C5D6BF"/><stop offset="1" stop-color="#8FA98A"/>
    </linearGradient>
    <linearGradient id="${id}-dot" x1="46" y1="10" x2="54" y2="20" gradientUnits="userSpaceOnUse">
      <stop stop-color="#96EEFB"/><stop offset="1" stop-color="#5BC4D6"/>
    </linearGradient>
    <pattern id="${id}-weave" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
      <path d="M0 3h6" stroke="#4F6A47" stroke-width=".7" opacity=".35"/>
      <path d="M3 0v6" stroke="#4F6A47" stroke-width=".55" opacity=".22"/>
    </pattern>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#${id}-tile)"/>
  <rect x="1.25" y="1.25" width="61.5" height="61.5" rx="14.75" fill="none" stroke="#fff" stroke-opacity=".08"/>
  <path d="M11 37.5c2.4 10.2 11 16 21 16s18.6-5.8 21-16c-3.4 5.2-10.8 8.6-21 8.6S14.4 42.7 11 37.5Z" fill="url(#${id}-nest)"/>
  <path d="M11 37.5c2.4 10.2 11 16 21 16s18.6-5.8 21-16c-3.4 5.2-10.8 8.6-21 8.6S14.4 42.7 11 37.5Z" fill="url(#${id}-weave)"/>
  <path d="M14.5 36.2c2 7.6 8.8 12 17.5 12s15.5-4.4 17.5-12" fill="none" stroke="#4F6A47" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>
  <path d="M18 35c1.6 5.4 6.8 8.6 14 8.6s12.4-3.2 14-8.6" fill="none" stroke="#FFFDF9" stroke-width="1.1" stroke-linecap="round" opacity=".35"/>
  <g transform="translate(22.5 16) rotate(-9)">
    <rect width="19" height="24" rx="2.2" fill="url(#${id}-paper)"/>
    <path d="M4 6.5h11M4 10.5h11M4 14.5h8" stroke="#1B1B1B" stroke-opacity=".28" stroke-width="1.2" stroke-linecap="round"/>
  </g>
  <g transform="translate(27.5 18.5) rotate(8)">
    <rect width="19" height="24" rx="2.2" fill="#FFFDF9"/>
    <rect width="19" height="24" rx="2.2" fill="none" stroke="#1B1B1B" stroke-opacity=".1"/>
    <path d="M4 6.5h11M4 10.5h11M4 14.5h7" stroke="#4F6A47" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M5.5 19.2 8.2 21.6 13.8 15.8" fill="none" stroke="#4F6A47" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g fill="#FFFDF9" opacity=".28">
    <circle cx="18" cy="42.5" r=".7"/><circle cx="24.5" cy="46.2" r=".55"/><circle cx="32" cy="47.8" r=".7"/>
    <circle cx="39.5" cy="46" r=".55"/><circle cx="46" cy="42.2" r=".7"/>
  </g>
  <circle cx="49" cy="15" r="4.2" fill="url(#${id}-dot)"/>
  <circle cx="49" cy="15" r="4.2" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>
</svg>`;
}

/** Brand row used in the sticky header. */
export function brandLockup(titleHtml) {
  return `<div class="brand">
    ${logoMark({ className: 'brand-mark', size: 40 })}
    <div class="brand-text">
      <h1>${titleHtml}</h1>
    </div>
  </div>`;
}
