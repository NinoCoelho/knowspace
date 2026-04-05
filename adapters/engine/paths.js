/**
 * Centralized OpenClaw path conventions and session key formats.
 * This is the single source of truth for all upstream path/key patterns.
 */

const path = require('path');
const crypto = require('crypto');

const HOME = process.env.HOME || '/home/nino';

function getEngineConfigPath() {
  return path.join(HOME, '.openclaw', 'openclaw.json');
}

function getSessionsJsonPath(clientSlug) {
  return path.join(HOME, '.openclaw', 'agents', clientSlug, 'sessions', 'sessions.json');
}

function getSessionPrefix(clientSlug) {
  return `agent:${clientSlug}:`;
}

function buildSessionKey(clientSlug, suffix) {
  return `agent:${clientSlug}:${suffix}`;
}

function buildNewSessionKey(clientSlug) {
  return `agent:${clientSlug}:web:direct:portal-${crypto.randomUUID()}`;
}

function getDefaultSessionKey(clientSlug) {
  return `agent:${clientSlug}:main`;
}

function getSkillsTargetPath() {
  return path.join(HOME, '.npm-global', 'lib', 'node_modules', 'openclaw', 'skills');
}

module.exports = {
  getEngineConfigPath,
  getSessionsJsonPath,
  getSessionPrefix,
  buildSessionKey,
  buildNewSessionKey,
  getDefaultSessionKey,
  getSkillsTargetPath,
};
