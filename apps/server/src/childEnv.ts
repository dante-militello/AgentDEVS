/**
 * Variables a running Claude Code session sets for its own children. If AgentDEVS is started from
 * inside a Claude terminal, inheriting them makes each new Claude think it is a sub-session, which
 * turns off transcript saving and breaks --resume.
 */
const INHERITED_SESSION_VARS = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|AGENTDEVS_(TERMINAL_ID|HOOK_URL|HOOK_TOKEN))$/

export function buildChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const inherited = Object.entries(parent).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !INHERITED_SESSION_VARS.test(entry[0]),
  )
  return { ...Object.fromEntries(inherited), ...extra }
}
