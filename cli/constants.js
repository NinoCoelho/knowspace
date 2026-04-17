/**
 * CLI-level constants for the single-user v2 architecture.
 *
 * Knowspace is no longer multi-tenant. A single logical slug still
 * flows through the auth layer (tokens file, req.clientSlug, OpenClaw
 * client routing) because OpenClaw itself is still multi-agent and
 * the portal needs to pick an identity when talking to its gateway.
 * For the user, that slug is an implementation detail — defaulting
 * here so token / configure commands don't ask for it.
 *
 * Override with KNOWSPACE_ADMIN_SLUG only if you know you need to.
 */

const DEFAULT_USER_SLUG = process.env.KNOWSPACE_ADMIN_SLUG || 'main';

module.exports = { DEFAULT_USER_SLUG };
