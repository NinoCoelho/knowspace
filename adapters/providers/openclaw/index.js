const fs = require('node:fs');

const sessions = require('./sessions');
const chat = require('./chat');
const messages = require('./messages');
const paths = require('./paths');

const DEFAULT_AGENT_KIND = 'chat';

function readAgentsFromConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(paths.getEngineConfigPath(), 'utf8'));
    const list = config?.agents?.list;
    if (!Array.isArray(list)) return [];
    return list.map(entry => ({
      id: entry.id,
      name: entry.name || entry.id,
      kind: DEFAULT_AGENT_KIND,
      description: entry.identity?.theme,
    }));
  } catch {
    return [];
  }
}

/** @type {import('../types').Provider} */
const provider = {
  id: 'openclaw',
  capabilities: {
    persistentSessions: true,
    streaming: 'poll',
    toolUse: true,
    fileAttachments: true,
    cwdBinding: false,
    multiAgent: true,
  },
  async listAgents() {
    return readAgentsFromConfig();
  },
  listSessions: (agentId) => sessions.listSessions(agentId),
  createSession: (agentId) => sessions.createSession(agentId),
  renameSession: (sessionKey, label) => sessions.renameSession(sessionKey, label),
  deleteSession: (sessionKey) => sessions.deleteSession(sessionKey),
  loadHistory: (sessionKey, limit) => chat.loadHistory(sessionKey, limit),
  sendMessage: (sessionKey, text) => chat.sendMessage(sessionKey, text),
  pollForReply: (sessionKey, msgCountBefore, opts) => chat.pollForReply(sessionKey, msgCountBefore, opts),
  async health() {
    try {
      await sessions.listSessions('__health__', 0);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  },
};

module.exports = { sessions, chat, messages, paths, provider };
