// Codex daily budget configuration.
// AGENTS.md: hard cap is committed config; runtime cannot raise it.

export const CODEX_DAILY_HARD_CAP_USD = 5.0;
export const CODEX_BUDGET_LOCK_PATH = process.env.CODEX_BUDGET_LOCK_PATH || "data/codex/budget-lock.json";
