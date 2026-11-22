// Pet artwork as parametric SVG, shared by the kiosk and the dashboard.
//   Byte  — the Computer Science pocket robot (teal)
//   Sigma — the Data Science owl (purple)
// renderPet(petId, mood, { celebrate }) -> SVG markup string.
// Moods: ecstatic | happy | okay | sad | gloomy.  Animations live in pets.css.

const MOUTHS = {
  ecstatic: (x, y, c) => `<path d="M${x - 14} ${y - 3} Q${x} ${y + 18} ${x + 14} ${y - 3} Z" fill="${c}"/>`,
  happy: (x, y, c) => `<path d="M${x - 11} ${y - 2} Q${x} ${y + 10} ${x + 11} ${y - 2}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  okay: (x, y, c) => `<path d="M${x - 8} ${y} Q${x} ${y + 4} ${x + 8} ${y}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  sad: (x, y, c) => `<path d="M${x - 9} ${y + 4} Q${x} ${y - 4} ${x + 9} ${y + 4}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
  gloomy: (x, y, c) => `<path d="M${x - 11} ${y + 6} Q${x} ${y - 7} ${x + 11} ${y + 6}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
};

function partyHat(x, y, color) {
  return `<g class="pet-hat">
    <path d="M${x - 18} ${y} L${x} ${y - 42} L${x + 18} ${y} Z" fill="${color}" stroke="#fff" stroke-width="2"/>
    <path d="M${x - 12} ${y - 12} L${x + 12} ${y - 12}" stroke="#ffd34d" stroke-width="4"/>
    <path d="M${x - 6} ${y - 26} L${x + 6} ${y - 26}" stroke="#ff5e8a" stroke-width="4"/>
    <circle cx="${x}" cy="${y - 44}" r="6" fill="#ffd34d"/>
  </g>`;
}

function tear(x, y) {
  return `<path class="pet-tear" d="M${x} ${y} q-5 8 0 11 q5 -3 0 -11 Z" fill="#7cc8ff"/>`;
}

// ---------------------------------------------------------------- Byte (CS)
function byte(mood, celebrate) {
  const glow = { ecstatic: '#ffe066', happy: '#7cffcb', okay: '#9be7ff', sad: '#8aa1b1', gloomy: '#5c6b75' }[mood];
  const px = '#7cffcb'; // screen pixels
  const eyes = (() => {
    const L = 82, R = 118, Y = 98;
    if (mood === 'ecstatic' || celebrate) {
      return [L, R].map((x) => `<path d="M${x - 8} ${Y + 4} L${x} ${Y - 5} L${x + 8} ${Y + 4}" fill="none" stroke="${px}" stroke-width="5" stroke-linecap="square"/>`).join('');
    }
    if (mood === 'sad' || mood === 'gloomy') {
      const drop = mood === 'gloomy' ? 4 : 2;
      return `<g class="pet-eyes">${[L, R].map((x) => `<rect x="${x - 7}" y="${Y - 2 + drop}" width="14" height="${mood === 'gloomy' ? 5 : 8}" fill="${px}"/>`).join('')}</g>`
        + (mood === 'gloomy' ? tear(R + 6, Y + 8) : '');
    }
    const h = mood === 'happy' ? 14 : 12;
    return `<g class="pet-eyes">${[L, R].map((x) => `<rect x="${x - 7}" y="${Y - h / 2}" width="14" height="${h}" fill="${px}"/>
      ${mood === 'happy' ? `<rect x="${x - 4}" y="${Y - h / 2 + 2}" width="4" height="4" fill="#0f2a33"/>` : ''}`).join('')}</g>`;
  })();
  const cheeks = mood === 'ecstatic' || mood === 'happy' || celebrate
    ? `<rect x="66" y="110" width="9" height="5" rx="2" fill="#ff8fb1"/><rect x="125" y="110" width="9" height="5" rx="2" fill="#ff8fb1"/>` : '';

  return `
  <g class="pet-arm pet-arm-l"><rect x="28" y="104" width="22" height="14" rx="7" fill="#1a9486"/></g>
  <g class="pet-arm pet-arm-r"><rect x="150" y="104" width="22" height="14" rx="7" fill="#1a9486"/></g>
  <rect x="62" y="158" width="24" height="16" rx="6" fill="#16786d"/>
  <rect x="114" y="158" width="24" height="16" rx="6" fill="#16786d"/>
  <line x1="100" y1="62" x2="100" y2="38" stroke="#16786d" stroke-width="5" stroke-linecap="round"/>
  <circle class="pet-antenna" cx="100" cy="32" r="8" fill="${glow}" stroke="#16786d" stroke-width="3"/>
  <rect x="45" y="58" width="110" height="106" rx="30" fill="#22b8a7"/>
  <rect x="45" y="58" width="110" height="40" rx="30" fill="#3fd0be" opacity=".55"/>
  <rect x="58" y="72" width="84" height="56" rx="13" fill="#0f2a33"/>
  <rect x="62" y="76" width="18" height="4" rx="2" fill="#ffffff" opacity=".15"/>
  ${eyes}
  ${MOUTHS[celebrate ? 'ecstatic' : mood](100, 117, px)}
  ${cheeks}
  <text x="100" y="152" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" font-size="17" fill="#0f2a33" opacity=".75">&lt;/&gt;</text>
  ${celebrate ? partyHat(100, 62, '#ff5e8a') : ''}`;
}

// --------------------------------------------------------------- Sigma (DS)
function sigma(mood, celebrate) {
  const eyes = (() => {
    const L = 80, R = 120, Y = 92;
    const rings = [L, R].map((x) => `<circle cx="${x}" cy="${Y}" r="19" fill="#fff"/>`).join('');
    const glasses = `<g fill="none" stroke="#3b2370" stroke-width="3.5">
        <circle cx="${L}" cy="${Y}" r="21"/><circle cx="${R}" cy="${Y}" r="21"/>
        <path d="M${L + 21} ${Y} Q100 ${Y - 6} ${R - 21} ${Y}"/></g>`;
    if (mood === 'ecstatic' || celebrate) {
      return rings + [L, R].map((x) => `<path d="M${x - 10} ${Y + 4} Q${x} ${Y - 10} ${x + 10} ${Y + 4}" fill="none" stroke="#2a1854" stroke-width="5" stroke-linecap="round"/>`).join('') + glasses;
    }
    const pupils = [L, R].map((x) => `<circle cx="${x + 2}" cy="${Y + 2}" r="${mood === 'happy' ? 10 : 9}" fill="#2a1854"/>
        <circle cx="${x + 5}" cy="${Y - 2}" r="3.2" fill="#fff"/>`).join('');
    let lids = '';
    if (mood === 'sad' || mood === 'gloomy') {
      const lidY = mood === 'gloomy' ? Y + 2 : Y - 5;
      lids = [L, R].map((x) => `<path d="M${x - 20} ${Y - 2} A20 20 0 0 1 ${x + 20} ${Y - 2} L${x + 20} ${lidY} L${x - 20} ${lidY} Z" fill="#7444d6"/>`).join('');
    }
    return rings + `<g class="pet-eyes">${pupils}</g>` + lids + glasses + (mood === 'gloomy' ? tear(R + 10, Y + 16) : '');
  })();
  const cheeks = mood === 'ecstatic' || mood === 'happy' || celebrate
    ? `<ellipse cx="62" cy="116" rx="7" ry="4" fill="#ff8fb1" opacity=".8"/><ellipse cx="138" cy="116" rx="7" ry="4" fill="#ff8fb1" opacity=".8"/>` : '';
  const beakMood = celebrate ? 'ecstatic' : mood;
  const beak = beakMood === 'ecstatic'
    ? `<path d="M92 110 L108 110 L100 124 Z" fill="#ff9f43"/><path d="M94 112 L106 112 L100 120 Z" fill="#c0392b"/>`
    : `<path d="M93 108 L107 108 L100 ${beakMood === 'sad' || beakMood === 'gloomy' ? 116 : 120} Z" fill="#ff9f43"/>`;

  return `
  <path d="M62 66 L56 34 L84 56 Z" fill="#6d3fd0"/>
  <path d="M138 66 L144 34 L116 56 Z" fill="#6d3fd0"/>
  <g class="pet-arm pet-arm-l"><ellipse cx="44" cy="122" rx="14" ry="30" fill="#6d3fd0" transform="rotate(14 44 122)"/></g>
  <g class="pet-arm pet-arm-r"><ellipse cx="156" cy="122" rx="14" ry="30" fill="#6d3fd0" transform="rotate(-14 156 122)"/></g>
  <ellipse cx="100" cy="112" rx="60" ry="64" fill="#8b5cf6"/>
  <ellipse cx="100" cy="74" rx="46" ry="22" fill="#a78bfa" opacity=".45"/>
  <ellipse cx="100" cy="142" rx="38" ry="32" fill="#ede4ff"/>
  <rect x="80" y="146" width="9" height="14" rx="2" fill="#a78bfa"/>
  <rect x="95" y="138" width="9" height="22" rx="2" fill="#8b5cf6"/>
  <rect x="110" y="130" width="9" height="30" rx="2" fill="#6d3fd0"/>
  <path d="M78 142 L98 132 L112 124 L124 118" fill="none" stroke="#ff9f43" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="124" cy="118" r="3" fill="#ff9f43"/>
  ${eyes}
  ${beak}
  ${cheeks}
  <path d="M80 174 l-6 6 M80 174 l0 7 M80 174 l6 6 M120 174 l-6 6 M120 174 l0 7 M120 174 l6 6" stroke="#ff9f43" stroke-width="4" stroke-linecap="round"/>
  ${celebrate ? partyHat(100, 52, '#22b8a7') : ''}`;
}

export function renderPet(petId, mood = 'happy', { celebrate = false, title } = {}) {
  const body = petId === 'cs' ? byte(mood, celebrate) : sigma(mood, celebrate);
  const label = title || (petId === 'cs' ? 'Byte, the CS pet' : 'Sigma, the DS pet');
  return `<svg class="pet pet-${petId} mood-${mood}${celebrate ? ' celebrating' : ''}" viewBox="0 0 200 200" role="img" aria-label="${label} (${celebrate ? 'celebrating' : mood})" xmlns="http://www.w3.org/2000/svg">
  <ellipse class="pet-shadow" cx="100" cy="184" rx="52" ry="8" fill="#000" opacity=".12"/>
  <g class="pet-body">${body}</g>
</svg>`;
}

export const MOOD_LABEL = {
  ecstatic: 'Over the moon',
  happy: 'Happy',
  okay: 'Doing okay',
  sad: 'A bit lonely',
  gloomy: 'Really misses you',
};
