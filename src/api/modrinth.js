import { friendlyFetch } from '../utils/netError.js';

const API = 'https://api.modrinth.com/v2';

async function get(pathAndQuery) {
  const res = await friendlyFetch(`${API}${pathAndQuery}`, 'Modrinth недоступен', 'api.modrinth.com');
  return res.json();
}

export function searchProjects({
  query = '', projectType = 'modpack', limit = 20, index = 'downloads', offset = 0,
  mcVersion = null, loader = null, categories = [], loaders = [], environment = [],
}) {
  const facetGroups = [[`project_type:${projectType}`]];
  if (mcVersion) facetGroups.push([`versions:${mcVersion}`]);
  // Several loaders ticked in the search page: any of them (as on Modrinth's own site). Only mods and modpacks have loaders.
  if (loaders.length && (projectType === 'mod' || projectType === 'modpack')) facetGroups.push(loaders.map((l) => `categories:${l}`));
  // "Client" / "Server": the project works on that side (required or optional). Both ticked: it has to work on both.
  for (const side of environment) {
    if (side === 'client' || side === 'server') facetGroups.push([`${side}_side:required`, `${side}_side:optional`]);
  }
  // The loader (fabric/quilt) category only means anything for mods on
  // Modrinth — shaders and resource packs aren't tagged by loader at all,
  // so applying this facet to them filtered out almost every result.
  if (loader && loader !== 'vanilla' && projectType === 'mod') facetGroups.push([`categories:${loader}`]);
  // Selected category checkboxes are OR'd together (any match), same as
  // Modrinth's own site.
  if (categories.length) facetGroups.push(categories.map((c) => `categories:${c}`));
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    index,
    offset: String(offset),
    facets: JSON.stringify(facetGroups),
  });
  return get(`/search?${params.toString()}`);
}

let categoryTagsCache = null;
export async function getCategoryTags() {
  if (!categoryTagsCache) categoryTagsCache = get('/tag/category');
  try {
    return await categoryTagsCache;
  } catch (err) {
    categoryTagsCache = null;
    throw err;
  }
}

// Release versions of the game, newest first (for the version filter).
let gameVersionsCache = null;
export async function getGameVersions() {
  if (!gameVersionsCache) gameVersionsCache = get('/tag/game_version');
  try {
    const all = await gameVersionsCache;
    return all.filter((v) => v.version_type === 'release').map((v) => v.version);
  } catch (err) {
    gameVersionsCache = null;
    throw err;
  }
}

export function getProject(idOrSlug) {
  return get(`/project/${encodeURIComponent(idOrSlug)}`);
}

export function getProjectVersions(idOrSlug) {
  return get(`/project/${encodeURIComponent(idOrSlug)}/version`);
}

export function getTeamMembers(teamId) {
  return get(`/team/${encodeURIComponent(teamId)}/members`);
}

export function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function formatRelativeDate(iso) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'сегодня';
  if (days < 30) return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')} назад`;
  const years = Math.floor(months / 12);
  return `${years} ${pluralRu(years, 'год', 'года', 'лет')} назад`;
}

export function formatDuration(ms) {
  if (!ms || ms < 1000) return '0 seconds';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} ${pluralRu(totalSeconds, 'секунда', 'секунды', 'seconds')}`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} ${pluralRu(totalMinutes, 'минута', 'минуты', 'минут')}`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} ${pluralRu(totalHours, 'час', 'часа', 'часов')}`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays} ${pluralRu(totalDays, 'день', 'дня', 'дней')}`;
}
