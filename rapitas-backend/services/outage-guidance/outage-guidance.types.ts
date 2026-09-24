/**
 * outage-guidance.types
 *
 * Shared types and verdict thresholds for the dependency-graph based outage
 * guidance (stop-impact assessment of a team's runtime services). Holds no
 * logic — graph traversal, classification and back-testing live in sibling
 * modules.
 */

/** Architectural layer a service belongs to. */
export type ServiceLayer = 'api' | 'cache' | 'db' | 'worker' | 'external';

/** All valid service layers (validation source of truth). */
export const SERVICE_LAYERS: readonly ServiceLayer[] = ['api', 'cache', 'db', 'worker', 'external'];

/** How a service depends on another (API call, cache read, DB query). */
export type DependencyKind = 'api_call' | 'cache_read' | 'db_query';

/** All valid dependency kinds (validation source of truth). */
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ['api_call', 'cache_read', 'db_query'];

/** Three-level stop verdict: safe to stop / risky / dangerous. */
export type OutageVerdict = 'safe' | 'risk' | 'danger';

/** All verdicts, in severity order. */
export const OUTAGE_VERDICTS: readonly OutageVerdict[] = ['safe', 'risk', 'danger'];

/** One runtime service of the team. */
export interface ServiceDefinition {
  /** Stable id (`^[a-z0-9][a-z0-9._-]{0,63}$`). */
  id: string;
  /** Human-readable name shown in Slack. */
  name: string;
  layer: ServiceLayer;
  /** Maximum outage (minutes) this service tolerates before breaching its SLA. */
  slaMinutes: number;
  /** Owner-declared recovery estimate, used when history is too thin. */
  declaredRecoveryMinutes: number;
}

/** Directed edge: `from` depends on `to`. */
export interface ServiceDependency {
  from: string;
  to: string;
  kind: DependencyKind;
}

/** A past outage of one service — recovery history and accuracy ground truth. */
export interface IncidentRecord {
  id: string;
  targetServiceId: string;
  /** ISO 8601 timestamp. */
  occurredAt: string;
  actualRecoveryMinutes: number;
  /** Services that were actually impacted (excluding the target itself). */
  actualImpactedServiceIds: string[];
  /** Operator-provided ground-truth label; overrides the derived one. */
  label?: OutageVerdict;
}

/** Validated inventory file content (schema version 1). */
export interface OutageInventory {
  version: 1;
  /** Owning team name (informational). */
  team?: string;
  services: ServiceDefinition[];
  dependencies: ServiceDependency[];
  incidents: IncidentRecord[];
}

/** One service transitively impacted when the target stops. */
export interface AffectedService {
  serviceId: string;
  /** Hop count from the target (1 = direct dependent). */
  depth: number;
  /** Shortest evidence path `[affected, …, target]`. */
  path: string[];
}

/** Why a verdict was reached. */
export type OutageReason =
  | 'recovery_exceeds_tolerance'
  | 'wide_blast_radius'
  | 'insufficient_history'
  | 'within_safety_margin'
  | 'narrow_margin';

/** Result of assessing a stop of one service. */
export interface OutageAssessment {
  targetServiceId: string;
  verdict: OutageVerdict;
  /** Estimated recovery time R (minutes). */
  estimatedRecoveryMinutes: number;
  /** Tolerance T = lowest SLA among target + impacted (the impact floor). */
  toleranceMinutes: number;
  historySamples: number;
  /** Impacted count / (total services - 1). */
  blastRatio: number;
  affected: AffectedService[];
  reasons: OutageReason[];
  /** Graph traversal + classification time (excludes file IO and Slack). */
  computedInMs: number;
}

/** One back-test prediction that disagreed with ground truth. */
export interface SimulationMismatch {
  incidentId: string;
  expected: OutageVerdict;
  predicted: OutageVerdict;
}

/** Back-test outcome status. */
export type SimulationStatus = 'passed' | 'failed' | 'insufficient_data';

/** Result of back-testing the classifier against past incidents. */
export interface SimulationReport {
  total: number;
  correct: number;
  accuracy: number;
  threshold: number;
  status: SimulationStatus;
  /** confusion[expected][predicted] = count. */
  confusion: Record<OutageVerdict, Record<OutageVerdict, number>>;
  mismatches: SimulationMismatch[];
  evaluatedAt: string;
}

/**
 * Safe requires R <= 0.5 × T: half of the tolerance is kept as safety margin
 * for detection and hand-off time that the recovery history does not capture.
 */
export const SAFE_RECOVERY_RATIO = 0.5;

/** Safe requires the stop to reach fewer than a quarter of the other services. */
export const SAFE_BLAST_RATIO = 0.25;

/** Reaching half or more of the other services makes a stop dangerous regardless of R. */
export const DANGER_BLAST_RATIO = 0.5;

/** Below 3 samples a p90 is meaningless, so history is treated as insufficient. */
export const MIN_HISTORY_SAMPLES = 3;

/** Below 10 incidents one miss moves accuracy by >10pt, so no pass/fail verdict is given. */
export const MIN_SIMULATION_INCIDENTS = 10;

/** Required back-test accuracy (acceptance criterion: >= 90% vs past incidents). */
export const ACCURACY_THRESHOLD = 0.9;

/** Percentile used to estimate recovery from history (biased toward slow recoveries). */
export const RECOVERY_PERCENTILE = 0.9;
