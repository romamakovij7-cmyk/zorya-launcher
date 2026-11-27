// Human-readable result of installing a mod's required dependencies
// ({ installed: [{title}], failed: [{title, error}] } from the main process).
export function depsNote(deps) {
  if (!deps) return null;
  const parts = [];
  if (deps.installed?.length) parts.push(`Dependencies have also been established: ${deps.installed.map((d) => d.title).join(', ')}.`);
  const failed = (deps.failed || []).map((d) => `${d.title} (${d.error})`);
  return { text: parts.join(' '), warning: failed.length ? `It was not possible to establish dependencies: ${failed.join('; ')}.` : '' };
}
