/**
 * Intake Task Row
 *
 * Shared row shape read by the intake gate and its contamination-detection
 * helpers. Split out of intake-gate.ts purely to let intake-gate.ts and
 * intake-contamination-gate.ts both import it without a runtime import cycle
 * between the two.
 */
import type { SpecQualityInput } from './spec-quality-checker';

/** The task fields the gate reads — typed loosely so a pre-migration Prisma
 * client (no goals/constraints/acceptanceCriteria columns) degrades gracefully
 * to "fields absent → treated as missing" instead of crashing. */
export interface IntakeTaskRow extends SpecQualityInput {
  id: number;
  title: string;
  workflowStatus: string | null;
}
