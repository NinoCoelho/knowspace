/**
 * Session-to-provider routing.
 *
 * Knowspace v2 lets a single chat-loop handle sessions from multiple
 * providers (OpenClaw, ACP, future). The provider that owns a session
 * is encoded in the session key prefix:
 *
 *   acp:<agentId>:<uuid>          → acp provider
 *   agent:<slug>:<...>            → openclaw provider (legacy default)
 *
 * Anything that doesn't match a known prefix falls back to the default
 * provider. This keeps existing OpenClaw consumers working unchanged.
 */

const registry = require('../adapters/providers');

const PREFIXES = [
  { prefix: 'acp:',   providerId: 'acp' },
  { prefix: 'agent:', providerId: 'openclaw' },
];

function detectProviderId(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return registry.DEFAULT_PROVIDER_ID;
  for (const p of PREFIXES) {
    if (sessionKey.startsWith(p.prefix)) return p.providerId;
  }
  return registry.DEFAULT_PROVIDER_ID;
}

function getProviderForSession(sessionKey) {
  return registry.getProvider(detectProviderId(sessionKey));
}

/**
 * Aggregate sessions across all configured providers. The OpenClaw
 * provider needs a clientSlug to scope its listing; ACP doesn't.
 * Returns an array of `{ providerId, ...session }` objects.
 */
async function listAllSessions({ clientSlug } = {}) {
  const out = [];
  for (const provider of registry.listProviders()) {
    try {
      let sessions;
      if (provider.id === 'openclaw') {
        sessions = clientSlug ? await provider.listSessions(clientSlug) : [];
      } else if (provider.id === 'acp') {
        // ACP doesn't filter by client — list every agent's sessions.
        const agents = await provider.listAgents();
        const acc = [];
        for (const a of agents) {
          try {
            acc.push(...await provider.listSessions(a.id));
          } catch (err) {
            console.error(`[router] acp:${a.id} listSessions failed:`, err.message);
          }
        }
        sessions = acc;
      } else {
        // Unknown providers: best-effort no-arg call.
        try { sessions = await provider.listSessions(''); } catch { sessions = []; }
      }
      for (const s of sessions || []) out.push({ providerId: provider.id, ...s });
    } catch (err) {
      console.error(`[router] ${provider.id} listSessions failed:`, err.message);
    }
  }
  return out;
}

module.exports = { detectProviderId, getProviderForSession, listAllSessions, PREFIXES };
