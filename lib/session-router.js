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
 * Aggregate sessions across all configured providers and all of their
 * agents. Each returned session is stamped with `providerId`,
 * `agentId`, and `agentName` so the sidebar can show which identity
 * owns each conversation.
 *
 * `clientSlug` is honored only as a hint for the legacy OpenClaw
 * default agent — the multi-tenant filter is gone, so all OpenClaw
 * agents listed in openclaw.json contribute their sessions.
 */
async function listAllSessions({ clientSlug } = {}) {
  void clientSlug; // kept for back-compat; multi-tenant filter is gone in v2
  const out = [];
  for (const provider of registry.listProviders()) {
    try {
      const agents = await provider.listAgents();
      for (const a of agents) {
        let sessions;
        try {
          sessions = await provider.listSessions(a.id);
        } catch (err) {
          console.error(`[router] ${provider.id}:${a.id} listSessions failed:`, err.message);
          continue;
        }
        for (const s of sessions || []) {
          out.push({
            providerId: provider.id,
            agentId:    a.id,
            agentName:  a.name || a.id,
            ...s,
          });
        }
      }
    } catch (err) {
      console.error(`[router] ${provider.id} aggregation failed:`, err.message);
    }
  }
  return out;
}

module.exports = { detectProviderId, getProviderForSession, listAllSessions, PREFIXES };
