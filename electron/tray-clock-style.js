'use strict';
function readTrayClockStyle(prefs = {}) {
  const menuBarCompactClock = prefs.menuBarCompactClock === true;
  return { menuBarShowDate: !menuBarCompactClock && prefs.menuBarShowDate !== false, menuBarCompactClock };
}
function initialTrayClockStyle(prefs, existingProfile) {
  return existingProfile ? readTrayClockStyle(prefs) : {menuBarShowDate:false, menuBarCompactClock:true};
}
function nextTrayClockStyle(current, key, enabled) {
  if (typeof enabled !== 'boolean' || !['menuBarShowDate','menuBarCompactClock'].includes(key)) return current;
  const other = key === 'menuBarShowDate' ? 'menuBarCompactClock' : 'menuBarShowDate';
  return {...current,[key]:enabled,...(enabled ? {[other]:false} : {})};
}
module.exports = { readTrayClockStyle, initialTrayClockStyle, nextTrayClockStyle };
