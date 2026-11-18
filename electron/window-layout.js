'use strict';

// Places the panel directly under the menu-bar item, right-aligned to it, and
// clamps both axes to the display work area. Pure and injectable so the
// 1280×800 fit can be tested without Electron.
function computePanelBounds(trayBounds, workArea, width, height) {
  const tray = trayBounds && typeof trayBounds === 'object' ? trayBounds : {};
  const area = workArea && typeof workArea === 'object' ? workArea : {};

  const areaX = Number.isFinite(area.x) ? area.x : 0;
  const areaY = Number.isFinite(area.y) ? area.y : 0;
  const areaWidth = Number.isFinite(area.width) ? area.width : width;
  const areaHeight = Number.isFinite(area.height) ? area.height : height;

  const trayX = Number.isFinite(tray.x) ? tray.x : areaX;
  const trayY = Number.isFinite(tray.y) ? tray.y : areaY;
  const trayWidth = Number.isFinite(tray.width) ? tray.width : 0;
  const trayHeight = Number.isFinite(tray.height) ? tray.height : 0;

  const minX = areaX;
  const maxX = Math.max(minX, areaX + areaWidth - width);
  const x = Math.min(Math.max(trayX + trayWidth - width, minX), maxX);

  const minY = areaY;
  const maxY = Math.max(minY, areaY + areaHeight - height);
  const y = Math.min(Math.max(trayY + trayHeight, minY), maxY);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height
  };
}

module.exports = {
  computePanelBounds
};
