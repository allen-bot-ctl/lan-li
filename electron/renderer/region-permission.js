'use strict';
document.getElementById('perm-open').addEventListener('click', () => window.lanliRegion.openPermissionSettings());
document.getElementById('perm-close').addEventListener('click', () => window.lanliRegion.closePermission());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.lanliRegion.closePermission();
  else if (e.key === 'Enter') { e.preventDefault(); window.lanliRegion.openPermissionSettings(); }
});
