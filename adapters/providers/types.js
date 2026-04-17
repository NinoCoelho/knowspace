/**
 * Knowspace v2 — Provider interface (JSDoc types only).
 *
 * A Provider is a backend that exposes one or more Agents and their
 * conversation Sessions to Knowspace. Two concrete providers currently
 * exist: `openclaw` (WebSocket gateway) and `acp` (JSON-RPC stdio,
 * covering Claude Code, Hermes, Codex, Gemini).
 *
 * The interface deliberately mirrors the shape already used by the
 * existing OpenClaw adapter so that `server.js` can switch providers
 * without touching the chat/session control flow.
 *
 * @typedef {Object} Capabilities
 * @property {boolean} persistentSessions  Agent keeps session state across sends
 * @property {'poll'|'native'} streaming   How replies arrive (poll = history diff, native = push)
 * @property {boolean} toolUse             Agent reports tool_use / tool_result events
 * @property {boolean} fileAttachments     Agent accepts file attachments in messages
 * @property {boolean} cwdBinding          Sessions can be bound to a working directory (coder mode)
 * @property {boolean} multiAgent          Provider exposes multiple named agents
 *
 * @typedef {Object} Agent
 * @property {string}  id                  Stable id within this provider (e.g. "claude-code", "jhones")
 * @property {string}  name                Human-readable display name
 * @property {'chat'|'coder'} kind         Chat-only vs project-bound
 * @property {string=} defaultCwd          Default working directory for coder-kind agents
 * @property {string=} description         Optional short description
 *
 * @typedef {Object} Session
 * @property {string}  key                 Opaque provider-native session identifier
 * @property {string}  label               Display label
 * @property {string=} updatedAt
 * @property {number=} totalTokens
 * @property {boolean=} isSubagent         True for internal sub-sessions that shouldn't appear in the sidebar
 *
 * @typedef {Object} Message
 * @property {'user'|'assistant'} role
 * @property {string}  content
 * @property {string=} timestamp
 * @property {Object=} subagent
 *
 * @typedef {Object} PollOptions
 * @property {(p: { status: string, tools: any[] }) => void}  [onProgress]
 * @property {(m: Message) => void}                            [onMessage]
 * @property {() => boolean}                                   [isDisconnected]
 * @property {number}                                          [pollIntervalMs]
 * @property {number}                                          [maxPolls]
 * @property {number}                                          [idlePollsToStop]
 *
 * @typedef {Object} Provider
 * @property {string}                                                       id
 * @property {Capabilities}                                                 capabilities
 * @property {() => Promise<Agent[]>}                                       listAgents
 * @property {(agentId: string) => Promise<Session[]>}                      listSessions
 * @property {(agentId: string, opts?: { label?: string, cwd?: string }) => Promise<string>} createSession
 * @property {(sessionKey: string, label: string) => Promise<void>}         renameSession
 * @property {(sessionKey: string) => Promise<void>}                        deleteSession
 * @property {(sessionKey: string, limit?: number) => Promise<Message[]>}   loadHistory
 * @property {(sessionKey: string, text: string) => Promise<void>}          sendMessage
 * @property {(sessionKey: string, msgCountBefore: number, opts?: PollOptions) => Promise<{ found: boolean, disconnected: boolean }>} pollForReply
 * @property {() => Promise<{ ok: boolean, detail?: string }>}              [health]
 */

module.exports = {};
