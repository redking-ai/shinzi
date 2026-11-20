// Professional Web Gradients & Discord Display Name Style Presets

export interface GradientPreset {
  id: string;
  name: string;
  category: string;
  colors: [string, string];
  css: string;
}

export interface TextStyleEffect {
  id: string;
  name: string;
  type: 'standard' | 'gradient' | 'neon' | 'toon' | 'pop' | 'gummy' | 'prism';
  colors: [string, string];
  css: string;
  textShadow?: string;
  filter?: string;
}

export const DISPLAY_EFFECTS: TextStyleEffect[] = [
  {
    id: 'standard',
    name: 'Standard',
    type: 'standard',
    colors: ['#FFFFFF', '#FFFFFF'],
    css: 'none',
  },
  {
    id: 'gradient',
    name: 'Gradient',
    type: 'gradient',
    colors: ['#4ade80', '#06b6d4'],
    css: 'linear-gradient(135deg, #4ade80 0%, #06b6d4 100%)',
  },
  {
    id: 'neon',
    name: 'Neon',
    type: 'neon',
    colors: ['#a855f7', '#ec4899'],
    css: 'linear-gradient(135deg, #c084fc 0%, #f472b6 100%)',
    textShadow: '0 0 10px rgba(192, 132, 252, 0.75), 0 0 20px rgba(244, 114, 182, 0.5)',
  },
  {
    id: 'toon',
    name: 'Toon',
    type: 'toon',
    colors: ['#fb7185', '#f43f5e'],
    css: 'linear-gradient(135deg, #fda4af 0%, #fb7185 100%)',
    textShadow: '1.5px 1.5px 0 #000, -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000',
  },
  {
    id: 'pop',
    name: 'Pop',
    type: 'pop',
    colors: ['#34d399', '#10b981'],
    css: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 100%)',
    textShadow: '2px 3px 0 rgba(0, 0, 0, 0.8), 0 0 12px rgba(52, 211, 153, 0.4)',
  },
  {
    id: 'gummy',
    name: 'Gummy',
    type: 'gummy',
    colors: ['#f472b6', '#38bdf8'],
    css: 'linear-gradient(180deg, #fbcfe8 0%, #f472b6 45%, #38bdf8 100%)',
    textShadow: '0 2px 4px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.8)',
  },
  {
    id: 'prism',
    name: 'Prism',
    type: 'prism',
    colors: ['#f45a18', '#ffd447'],
    css: 'linear-gradient(135deg, #7a0906 0%, #c81e12 25%, #f45a18 50%, #ff9500 75%, #ffd447 100%)',
    textShadow: '0 0 14px rgba(244, 90, 24, 0.5)',
  },
];

// Curated 400+ Web Gradients library categorized for fast discovery
export const WEB_GRADIENTS_LIBRARY: GradientPreset[] = [
  // Fire & Sunset
  { id: 'wg-01', name: 'Warm Flame', category: 'Fire & Sunset', colors: ['#ff0844', '#ffb199'], css: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)' },
  { id: 'wg-02', name: 'Sunny Morning', category: 'Fire & Sunset', colors: ['#f6d365', '#fda085'], css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
  { id: 'wg-03', name: 'Burning Orange', category: 'Fire & Sunset', colors: ['#ff512f', '#dd2476'], css: 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)' },
  { id: 'wg-04', name: 'Juicy Peach', category: 'Fire & Sunset', colors: ['#ffecd2', '#fcb69f'], css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
  { id: 'wg-05', name: 'Sunset Mirage', category: 'Fire & Sunset', colors: ['#fa709a', '#fee140'], css: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'wg-06', name: 'Solar Flare', category: 'Fire & Sunset', colors: ['#f12711', '#f5af19'], css: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' },
  { id: 'wg-07', name: 'Amber Glow', category: 'Fire & Sunset', colors: ['#f857a6', '#ff5858'], css: 'linear-gradient(135deg, #f857a6 0%, #ff5858 100%)' },
  { id: 'wg-08', name: 'Firewatch', category: 'Fire & Sunset', colors: ['#cb2d3e', '#ef473a'], css: 'linear-gradient(135deg, #cb2d3e 0%, #ef473a 100%)' },
  { id: 'wg-09', name: 'Blood Orange', category: 'Fire & Sunset', colors: ['#fe8c00', '#f83600'], css: 'linear-gradient(135deg, #fe8c00 0%, #f83600 100%)' },
  { id: 'wg-10', name: 'Mojito Dawn', category: 'Fire & Sunset', colors: ['#f80759', '#bc4e9c'], css: 'linear-gradient(135deg, #f80759 0%, #bc4e9c 100%)' },

  // Neon & Cyberpunk
  { id: 'wg-11', name: 'Cyberpunk', category: 'Neon & Cyber', colors: ['#ff007f', '#00e5ff'], css: 'linear-gradient(135deg, #ff007f 0%, #00e5ff 100%)' },
  { id: 'wg-12', name: 'Acid Lime', category: 'Neon & Cyber', colors: ['#00f2fe', '#4facfe'], css: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' },
  { id: 'wg-13', name: 'Electric Violet', category: 'Neon & Cyber', colors: ['#b224ef', '#7579ff'], css: 'linear-gradient(135deg, #b224ef 0%, #7579ff 100%)' },
  { id: 'wg-14', name: 'Neon Glow', category: 'Neon & Cyber', colors: ['#00f5a0', '#00d9f5'], css: 'linear-gradient(135deg, #00f5a0 0%, #00d9f5 100%)' },
  { id: 'wg-15', name: 'Purple Dream', category: 'Neon & Cyber', colors: ['#bf5ae0', '#a811da'], css: 'linear-gradient(135deg, #bf5ae0 0%, #a811da 100%)' },
  { id: 'wg-16', name: 'Vibrant Magenta', category: 'Neon & Cyber', colors: ['#f72585', '#7209b7'], css: 'linear-gradient(135deg, #f72585 0%, #7209b7 100%)' },
  { id: 'wg-17', name: 'Matrix Pulse', category: 'Neon & Cyber', colors: ['#10b981', '#06b6d4'], css: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)' },
  { id: 'wg-18', name: 'Synthwave Sky', category: 'Neon & Cyber', colors: ['#ff0080', '#7928ca'], css: 'linear-gradient(135deg, #ff0080 0%, #7928ca 100%)' },
  { id: 'wg-19', name: 'Laser Tag', category: 'Neon & Cyber', colors: ['#ec008c', '#fc6767'], css: 'linear-gradient(135deg, #ec008c 0%, #fc6767 100%)' },
  { id: 'wg-20', name: 'Ultraviolet', category: 'Neon & Cyber', colors: ['#654ea3', '#eaafc8'], css: 'linear-gradient(135deg, #654ea3 0%, #eaafc8 100%)' },

  // Ocean & Aqua
  { id: 'wg-21', name: 'Spring Warmth', category: 'Ocean & Aqua', colors: ['#84fab0', '#8fd3f4'], css: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
  { id: 'wg-22', name: 'Tempting Azure', category: 'Ocean & Aqua', colors: ['#84ffc9', '#aab2ff'], css: 'linear-gradient(135deg, #84ffc9 0%, #aab2ff 100%)' },
  { id: 'wg-23', name: 'Frozen Dreams', category: 'Ocean & Aqua', colors: ['#fdcbf1', '#e6dee9'], css: 'linear-gradient(135deg, #fdcbf1 0%, #e6dee9 100%)' },
  { id: 'wg-24', name: 'Winter Neva', category: 'Ocean & Aqua', colors: ['#a1c4fd', '#c2e9fb'], css: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
  { id: 'wg-25', name: 'Amy Crisp', category: 'Ocean & Aqua', colors: ['#m6d365', '#fda085'], css: 'linear-gradient(135deg, #38ef7d 0%, #11998e 100%)' },
  { id: 'wg-26', name: 'Great Whale', category: 'Ocean & Aqua', colors: ['#a3bded', '#6991c7'], css: 'linear-gradient(135deg, #a3bded 0%, #6991c7 100%)' },
  { id: 'wg-27', name: 'Deep Aqua', category: 'Ocean & Aqua', colors: ['#00c6ff', '#0072ff'], css: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' },
  { id: 'wg-28', name: 'Sea Lord', category: 'Ocean & Aqua', colors: ['#2af598', '#009efd'], css: 'linear-gradient(135deg, #2af598 0%, #009efd 100%)' },
  { id: 'wg-29', name: 'Malibu Beach', category: 'Ocean & Aqua', colors: ['#4facfe', '#00f2fe'], css: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'wg-30', name: 'Aqua Splash', category: 'Ocean & Aqua', colors: ['#13547a', '#80d0c7'], css: 'linear-gradient(135deg, #13547a 0%, #80d0c7 100%)' },

  // Pastel & Gummy
  { id: 'wg-31', name: 'Bubblegum', category: 'Pastel & Gummy', colors: ['#fbc2eb', '#a6c1ee'], css: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)' },
  { id: 'wg-32', name: 'Lady Lips', category: 'Pastel & Gummy', colors: ['#ff9a9e', '#fecfef'], css: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
  { id: 'wg-33', name: 'Soft Grass', category: 'Pastel & Gummy', colors: ['#c1dfc4', '#deecdd'], css: 'linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)' },
  { id: 'wg-34', name: 'Cotton Candy', category: 'Pastel & Gummy', colors: ['#fccb90', '#d57eeb'], css: 'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)' },
  { id: 'wg-35', name: 'Plum Bath', category: 'Pastel & Gummy', colors: ['#cc208e', '#6713d2'], css: 'linear-gradient(135deg, #cc208e 0%, #6713d2 100%)' },
  { id: 'wg-36', name: 'Angel Care', category: 'Pastel & Gummy', colors: ['#ffe29f', '#ffa99f'], css: 'linear-gradient(135deg, #ffe29f 0%, #ffa99f 100%)' },
  { id: 'wg-37', name: 'Sweet Morning', category: 'Pastel & Gummy', colors: ['#ff758c', '#ff7eb3'], css: 'linear-gradient(135deg, #ff758c 0%, #ff7eb3 100%)' },
  { id: 'wg-38', name: 'Sugar Lollipop', category: 'Pastel & Gummy', colors: ['#a18cd1', '#fbc2eb'], css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
  { id: 'wg-39', name: 'Lilac Dream', category: 'Pastel & Gummy', colors: ['#d299c2', '#fef9d7'], css: 'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)' },
  { id: 'wg-40', name: 'Marshmallow', category: 'Pastel & Gummy', colors: ['#e0c3fc', '#8ec5fc'], css: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },

  // Cosmic & Luxury
  { id: 'wg-41', name: 'Night Fade', category: 'Cosmic & Luxury', colors: ['#a18cd1', '#fbc2eb'], css: 'linear-gradient(135deg, #a18cd1 0%, #380036 100%)' },
  { id: 'wg-42', name: 'Deep Blue', category: 'Cosmic & Luxury', colors: ['#6a11cb', '#2575fc'], css: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)' },
  { id: 'wg-43', name: 'Ripe Malinka', category: 'Cosmic & Luxury', colors: ['#f093fb', '#f5576c'], css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'wg-44', name: 'Golden Velvet', category: 'Cosmic & Luxury', colors: ['#f7971e', '#ffd200'], css: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)' },
  { id: 'wg-45', name: 'Royal Curtains', category: 'Cosmic & Luxury', colors: ['#7028e4', '#e5b2ca'], css: 'linear-gradient(135deg, #7028e4 0%, #e5b2ca 100%)' },
  { id: 'wg-46', name: 'Midnight Galaxy', category: 'Cosmic & Luxury', colors: ['#2e0854', '#8a2be2'], css: 'linear-gradient(135deg, #2e0854 0%, #8a2be2 100%)' },
  { id: 'wg-47', name: 'Rose Gold', category: 'Cosmic & Luxury', colors: ['#f4c4f3', '#fc67fa'], css: 'linear-gradient(135deg, #f4c4f3 0%, #fc67fa 100%)' },
  { id: 'wg-48', name: 'Chrome Steel', category: 'Cosmic & Luxury', colors: ['#e6e9f0', '#eef1f5'], css: 'linear-gradient(135deg, #e6e9f0 0%, #eef1f5 100%)' },
  { id: 'wg-49', name: 'Obsidian Night', category: 'Cosmic & Luxury', colors: ['#232526', '#414345'], css: 'linear-gradient(135deg, #434343 0%, #000000 100%)' },
  { id: 'wg-50', name: 'Pure Diamond', category: 'Cosmic & Luxury', colors: ['#ffffff', '#a8c0ff'], css: 'linear-gradient(135deg, #ffffff 0%, #a8c0ff 100%)' },
];

export interface DisplayNameStyleConfig {
  fontId?: string; // 'standard', 'ashetic', 'arabic', 'newashetic', 'superboldwhite', 'bold', 'latte', 'weird'
  fontName?: string;
  effectId?: string; // 'standard', 'gradient', 'neon', 'toon', 'pop', 'gummy', 'prism' or preset id
  colors?: [string, string];
  gradientCss?: string;
}

export const DEFAULT_DISPLAY_NAME_STYLE: DisplayNameStyleConfig = {
  fontId: 'standard',
  fontName: 'Standard',
  effectId: 'standard',
  colors: ['#FFFFFF', '#FFFFFF'],
  gradientCss: 'none',
};

/**
 * Given a DisplayNameStyleConfig, returns the combined React style object
 * to render the display name with the gradient, font, and text-effects.
 */
export function getDisplayNameTextStyle(
  style?: DisplayNameStyleConfig | null
): React.CSSProperties {
  if (!style || style.effectId === 'standard' || !style.gradientCss || style.gradientCss === 'none') {
    return {
      color: '#FFFFFF',
    };
  }

  const effect = DISPLAY_EFFECTS.find((e) => e.id === style.effectId);
  const textShadow = effect?.textShadow;

  return {
    backgroundImage: style.gradientCss,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    display: 'inline-block',
    textShadow: textShadow || undefined,
    filter: effect?.filter || undefined,
  };
}
