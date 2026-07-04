/**
 * Environment sanitizer for spawned agent child processes.
 *
 * Agents (claude / codex / gemini) inherit process.env so their own CLI auth,
 * PATH, HOME, etc. keep working. But the dashboard's OWN remote-access secret
 * (ACCESS_TOKEN) must NOT leak into an agent's environment — an agent driving
 * Bash could otherwise read it and defeat the remote auth layer.
 *
 * Conservative: copy everything, delete only ACCESS_TOKEN. Do NOT switch to an
 * allowlist — that would strip the vars the agent CLIs need to authenticate.
 */
export function sanitizedChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ACCESS_TOKEN;
  return env;
}
