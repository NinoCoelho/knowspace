/**
 * Session management adapter for the upstream engine.
 * Wraps all session-related gateway RPC calls.
 */

const fs = require('fs');
const paths = require('./paths');

let _rpc = null;
function rpc(...args) {
  if (!_rpc) _rpc = require('../../lib/gateway').gatewayRpc;
  return _rpc(...args);
}

async function listSessions(clientSlug, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await rpc('sessions.list', {
        limit: 50,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      const prefix = paths.getSessionPrefix(clientSlug);
      const sessions = (result.sessions || [])
        .filter(s => s.key && s.key.startsWith(prefix))
        .map(s => ({
          key: s.key,
          label: s.label || s.derivedTitle || s.title || s.key.split(':').pop(),
          updatedAt: s.updatedAt,
          totalTokens: s.totalTokens,
        }));

      // Filter out sessions whose .jsonl files no longer exist on disk
      try {
        const sessionsJsonPath = paths.getSessionsJsonPath(clientSlug);
        const sessionsData = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
        return sessions.filter(s => {
          const entry = sessionsData[s.key];
          if (!entry || !entry.sessionFile) return true;
          return fs.existsSync(entry.sessionFile);
        });
      } catch {
        return sessions;
      }
    } catch (error) {
      if (attempt < retries) {
        console.log(`[gateway] Retrying sessions.list (attempt ${attempt + 2})...`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.error('Error listing sessions:', error.message);
        return [];
      }
    }
  }
}

async function createSession(clientSlug) {
  const key = paths.buildNewSessionKey(clientSlug);
  await rpc('sessions.patch', { key });
  return key;
}

async function renameSession(sessionKey, label) {
  await rpc('sessions.patch', { key: sessionKey, label });
}

async function deleteSession(sessionKey) {
  await rpc('sessions.delete', { key: sessionKey });
}

module.exports = {
  listSessions,
  createSession,
  renameSession,
  deleteSession,
  _setRpc(fn) { _rpc = fn; },
};
