const { app } = require('electron');
const logger = require('./logger');
const SETTINGS_KEY = 'launchOnStartup';
function set(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true, args: ['--hidden'] });
    logger.info('Auto-launch setting updated', { enabled });
  } catch (err) { logger.error('Auto-launch setting failed', { error: err.message }); }
}
function getStatus() { return app.getLoginItemSettings(); }
module.exports = { set, getStatus, SETTINGS_KEY };