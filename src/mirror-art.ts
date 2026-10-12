import type { MirrorMode } from './transforms';
/** Inline vector diagrams remain crisp at any UI scale. */
export function mirrorArt(mode: MirrorMode) {
  const transforms = { 'left-right': 'translate(80 0) scale(-1 1)', 'up-down': 'translate(0 80) scale(1 -1)', diagonal: 'translate(80 80) scale(-1 -1)' };
  const axes = mode === 'left-right' ? '<path d="M40 8V72"/>' : mode === 'up-down' ? '<path d="M8 40H72"/>' : '<path d="M40 8V72M8 40H72"/>';
  const sector = '<path d="M13 28 A30 30 0 0 1 27 13 L31 23 A19 19 0 0 0 23 32Z"/>';
  return `<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="25" fill="none" stroke="#3c565e" stroke-width="11"/><g stroke="#84baa9" stroke-dasharray="3 4" fill="none">${axes}</g><g fill="#ff4668">${sector}</g><g fill="#ff4668" transform="${transforms[mode]}">${sector}</g><circle cx="40" cy="40" r="3" fill="#bcf3d9"/></svg>`;
}
