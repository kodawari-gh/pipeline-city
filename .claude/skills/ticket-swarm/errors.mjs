/**
 * Why a ticket stopped, as its `kind`:
 * - `critical`: a git or tool failure. The worktrees stay for diagnosis, a rerun resumes it.
 * - `blocked`: the ticket cannot go on as written.
 * - `exhausted`: every tier failed.
 * - `permission`: an agent needs a command the permission rules refuse. The worktrees stay, a rerun resumes it.
 */
export class StopError extends Error {
  constructor(msg, kind) {
    super(msg);
    this.name = 'StopError';
    this.kind = kind;
  }
}
