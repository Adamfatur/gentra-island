// Which agent is which, at a glance. Claude's mark comes from Simple Icons
// (CC0); the mark is Anthropic's, shown only to name the agent. Simple Icons
// no longer carries OpenAI's, so Codex shows a terminal instead of a guess.

import { siClaude } from "simple-icons";
import type { AgentId } from "./agents";
import { icon } from "./icons";

const claude = `<svg viewBox="0 0 24 24" role="img" aria-hidden="true"><path fill="#${siClaude.hex}" d="${siClaude.path}"/></svg>`;

export function agentLogo(agent: AgentId): string {
  return `<span class="agent-logo ${agent}">${agent === "claude" ? claude : icon.terminal}</span>`;
}
