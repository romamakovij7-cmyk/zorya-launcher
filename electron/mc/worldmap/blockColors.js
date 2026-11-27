// Top-down map colours for blocks, in the spirit of Minecraft's own maps:
// name patterns first (so unknown/modded blocks of a familiar kind still get
// a sensible colour), then a stable per-name fallback.

const DYES = {
  white: [233, 236, 236], orange: [240, 118, 19], magenta: [189, 68, 179], light_blue: [58, 175, 217],
  yellow: [248, 197, 39], lime: [112, 185, 25], pink: [237, 141, 172], gray: [62, 68, 71],
  light_gray: [142, 142, 134], cyan: [21, 137, 145], purple: [121, 42, 172], blue: [53, 57, 157],
  brown: [114, 71, 40], green: [84, 109, 27], red: [160, 39, 34], black: [20, 21, 25],
};

const RULES = [
  [/^(water|bubble_column|flowing_water)$/, [50, 88, 190]],
  [/^(seagrass|tall_seagrass|kelp|kelp_plant)$/, [40, 110, 70]],
  [/^(lava|flowing_lava)$/, [230, 100, 20]],
  [/^(magma_block)$/, [140, 50, 20]],
  [/(snow|powder_snow)/, [245, 248, 250]],
  [/^(blue_ice)$/, [110, 160, 235]],
  [/^(packed_ice)$/, [150, 175, 235]],
  [/(^|_)ice$/, [160, 190, 240]],
  [/^(grass_block|short_grass|grass|tall_grass|fern|large_fern)$/, [104, 158, 58]],
  [/^(mycelium)$/, [111, 100, 110]],
  [/^(podzol)$/, [110, 76, 44]],
  [/^(mud|muddy_mangrove_roots)$/, [62, 56, 60]],
  [/^(moss_block|moss_carpet|azalea|flowering_azalea)$/, [90, 120, 45]],
  [/^(dirt_path|farmland)$/, [140, 105, 70]],
  [/(dirt|rooted_dirt)$/, [134, 96, 67]],
  [/(^|_)red_sand(stone)?/, [178, 92, 40]],
  [/(^|_)sand(stone)?$/, [219, 207, 163]],
  [/(^|_)soul_(sand|soil)$/, [82, 64, 52]],
  [/(^|_)gravel$/, [131, 127, 126]],
  [/^clay$/, [160, 166, 179]],
  [/^(birch_leaves)$/, [124, 156, 82]],
  [/^(spruce_leaves)$/, [62, 96, 62]],
  [/^(cherry_leaves)$/, [240, 176, 200]],
  [/^(dark_oak_leaves)$/, [40, 100, 35]],
  [/^(azalea_leaves|flowering_azalea_leaves)$/, [84, 124, 50]],
  [/leaves$/, [52, 128, 36]],
  [/(mangrove_roots)$/, [96, 78, 50]],
  [/^(cactus)$/, [60, 130, 50]],
  [/^(sugar_cane|bamboo|vine|lily_pad)$/, [80, 140, 60]],
  [/(mushroom_block|mushroom_stem)$/, [180, 160, 140]],
  [/^(pumpkin|carved_pumpkin|jack_o_lantern)$/, [210, 130, 30]],
  [/^(melon)$/, [120, 160, 50]],
  [/^(hay_block|wheat)$/, [200, 170, 60]],
  [/(terracotta)$/, [152, 94, 68]],
  [/^(netherrack|nether_bricks|nether_wart_block)$/, [110, 40, 40]],
  [/^(crimson_nylium|crimson_stem|crimson_planks)$/, [150, 50, 70]],
  [/^(warped_nylium|warped_stem|warped_planks|warped_wart_block)$/, [40, 130, 125]],
  [/^(basalt|smooth_basalt|polished_basalt|blackstone|gilded_blackstone)$/, [55, 52, 60]],
  [/^(soul_soil)$/, [80, 62, 50]],
  [/^(glowstone|shroomlight)$/, [240, 200, 110]],
  [/^(end_stone|end_stone_bricks)$/, [220, 222, 158]],
  [/^(purpur_block|purpur_pillar)$/, [170, 120, 170]],
  [/^(obsidian|crying_obsidian)$/, [26, 20, 40]],
  [/^(bedrock)$/, [70, 70, 70]],
  [/^(deepslate|cobbled_deepslate|polished_deepslate|deepslate_bricks|deepslate_tiles|tuff)/, [82, 82, 88]],
  [/(^|_)(stone|cobblestone|andesite|stone_bricks|smooth_stone)$/, [122, 122, 122]],
  [/^(granite|polished_granite)$/, [150, 105, 85]],
  [/^(diorite|polished_diorite|calcite)$/, [200, 200, 198]],
  [/^(dripstone_block|pointed_dripstone)$/, [130, 105, 90]],
  [/(_ore)$/, [125, 125, 125]],
  [/(planks|_log|_wood|_stem|_hyphae|stripped_)/, [148, 118, 70]],
  [/(bricks)$/, [150, 95, 82]],
  [/^(iron_block)$/, [200, 200, 200]],
  [/^(gold_block)$/, [246, 208, 62]],
  [/^(diamond_block)$/, [98, 220, 210]],
  [/^(emerald_block)$/, [60, 190, 90]],
  [/^(lapis_block)$/, [40, 80, 170]],
  [/^(redstone_block)$/, [190, 30, 20]],
  [/^(copper_block|cut_copper|copper)/, [190, 110, 80]],
  [/glass(_pane)?$/, [170, 205, 215]],
  [/^(quartz_block|smooth_quartz|quartz_bricks|quartz_pillar)$/, [235, 229, 222]],
  [/^(prismarine|prismarine_bricks)$/, [100, 160, 150]],
  [/^(sponge|wet_sponge)$/, [195, 190, 80]],
  [/^(sea_lantern)$/, [180, 200, 190]],
  [/^(coal_block)$/, [30, 30, 32]],
  [/^(barrel|chest|crafting_table|bookshelf|composter)$/, [140, 105, 60]],
  [/^(oak_|spruce_|birch_|jungle_|acacia_|dark_oak_|mangrove_|cherry_|bamboo_)/, [148, 118, 70]],
];

const cache = new Map();

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  // simple HSL(hue, 35%, 48%) -> rgb
  const s = 0.35;
  const l = 0.48;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function colorOf(fullName) {
  let c = cache.get(fullName);
  if (c) return c;
  const name = fullName.replace(/^[^:]*:/, '');
  const dye = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wool|concrete|concrete_powder|carpet|stained_glass|stained_glass_pane|terracotta|glazed_terracotta|shulker_box|bed|banner)$/.exec(name);
  if (dye) c = DYES[dye[1]];
  if (!c) {
    for (const [re, col] of RULES) {
      if (re.test(name)) { c = col; break; }
    }
  }
  if (!c) c = hashColor(fullName);
  cache.set(fullName, c);
  return c;
}

const isWater = (name) => name === 'minecraft:water' || name === 'minecraft:bubble_column';
const isAir = (name) => name === 'minecraft:air' || name === 'minecraft:cave_air' || name === 'minecraft:void_air';

module.exports = { colorOf, isWater, isAir };
