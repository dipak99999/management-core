// Task dependency status guard — pure decision rules for whether a task
// can transition from its current status to `nextStatus`, given the set
// of dependencies (fromTask → thisTask) and the current status of each
// fromTask. Called from the projects-service task PUT route to reject
// premature starts.
//
// Dependency-type meanings (matching TaskDependency.type enum):
//   FS  Finish-to-Start   — fromTask must be Completed before thisTask starts
//   SS  Start-to-Start    — fromTask must be InProgress (or later) before this starts
//   FF  Finish-to-Finish  — fromTask must be Completed before this can Complete
//   SF  Start-to-Finish   — fromTask must be InProgress (or later) before this can Complete
//
// Guard invariants:
//   - Reopening a task (any → Open) is always allowed — no dep check.
//   - Cancelling is always allowed.
//   - Only "starting" (→ InProgress) and "completing" (→ Completed) are gated.

export type TaskStatus = "Open" | "InProgress" | "Completed" | "Cancelled";
export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface DependencyLike {
  fromTaskId: string;
  type: DependencyType;
}

export interface FromTaskStatusMap {
  /** fromTaskId → its current status. Missing keys default to "Open" (worst-case). */
  [fromTaskId: string]: TaskStatus | undefined;
}

export interface Blocker {
  fromTaskId: string;
  fromTaskStatus: TaskStatus;
  reason: string;
}

export interface DependencyCheckResult {
  allowed: boolean;
  blockers: Blocker[];
}

/**
 * Check whether transitioning to `nextStatus` is allowed given deps.
 *
 * The set of gates that fire depends on the transition:
 *   → InProgress: FS + SS gates (starting)
 *   → Completed:  FS + SS + FF + SF gates (all four apply — completing
 *                 subsumes starting for FS/SS)
 *   → Open:       always allowed (reopen)
 *   → Cancelled:  always allowed
 */
export function canTransitionTask(
  nextStatus: TaskStatus,
  dependencies: DependencyLike[],
  fromTaskStatuses: FromTaskStatusMap,
): DependencyCheckResult {
  if (nextStatus === "Open" || nextStatus === "Cancelled")
    return { allowed: true, blockers: [] };

  const isStart = nextStatus === "InProgress";
  const isComplete = nextStatus === "Completed";
  const blockers: Blocker[] = [];

  for (const dep of dependencies) {
    const fromStatus = (fromTaskStatuses[dep.fromTaskId] ?? "Open") as TaskStatus;
    // Cancelled fromTask never blocks — the operator explicitly took it
    // out of the plan.
    if (fromStatus === "Cancelled") continue;

    if (dep.type === "FS" && (isStart || isComplete)) {
      if (fromStatus !== "Completed") {
        blockers.push({
          fromTaskId: dep.fromTaskId,
          fromTaskStatus: fromStatus,
          reason: `FS dependency not complete (currently ${fromStatus})`,
        });
      }
    } else if (dep.type === "SS" && (isStart || isComplete)) {
      if (fromStatus === "Open") {
        blockers.push({
          fromTaskId: dep.fromTaskId,
          fromTaskStatus: fromStatus,
          reason: `SS dependency not started (currently Open)`,
        });
      }
    } else if (dep.type === "FF" && isComplete) {
      if (fromStatus !== "Completed") {
        blockers.push({
          fromTaskId: dep.fromTaskId,
          fromTaskStatus: fromStatus,
          reason: `FF dependency not complete (currently ${fromStatus})`,
        });
      }
    } else if (dep.type === "SF" && isComplete) {
      if (fromStatus === "Open") {
        blockers.push({
          fromTaskId: dep.fromTaskId,
          fromTaskStatus: fromStatus,
          reason: `SF dependency not started (currently Open)`,
        });
      }
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

/**
 * "Is this task ready to start right now?" — convenience wrapper the
 * `/:id/dependency-status` endpoint uses. Same rules as
 * `canTransitionTask("InProgress", ...)` but returns a friendlier
 * summary shape for the UI.
 */
export function summarizeDependencyReadiness(
  dependencies: DependencyLike[],
  fromTaskStatuses: FromTaskStatusMap,
): {
  readyToStart: boolean;
  readyToComplete: boolean;
  startBlockers: Blocker[];
  completeBlockers: Blocker[];
} {
  const start = canTransitionTask("InProgress", dependencies, fromTaskStatuses);
  const complete = canTransitionTask("Completed", dependencies, fromTaskStatuses);
  return {
    readyToStart: start.allowed,
    readyToComplete: complete.allowed,
    startBlockers: start.blockers,
    completeBlockers: complete.blockers,
  };
}
