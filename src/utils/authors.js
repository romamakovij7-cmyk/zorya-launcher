// Settings → "Authors". Skins live in src/assets/authors/.
// The head is drawn from the skin together with its second layer (like the account avatar).

import mihalych from '../assets/authors/mihalych.png';
import ar1ma from '../assets/authors/ar1ma.png';
import placeholder from '../assets/authors/placeholder.png';

// All found supporter-*.png files (empty if none): filename without path → image URL
const found = import.meta.glob('../assets/authors/supporter-*.png', { eager: true, import: 'default' });
const supporterSkin = (file) => found[`../assets/authors/${file}.png`] || placeholder;

export const AUTHORS = [
  { name: 'Михалыч', skin: mihalych },
  { name: 'AR1MA', skin: ar1ma },
];

export const SUPPORTERS = [];
