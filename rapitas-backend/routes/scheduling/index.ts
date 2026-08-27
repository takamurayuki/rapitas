/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { schedulesRoutes } from './schedules';
import { dailyScheduleRoutes } from './daily-schedule';
import { pomodoroRoutes } from './pomodoro';
import { timeEntriesRoutes } from './time-entries';

export { schedulesRoutes } from './schedules';
export { dailyScheduleRoutes } from './daily-schedule';
export { pomodoroRoutes } from './pomodoro';
export { timeEntriesRoutes } from './time-entries';

export const schedulingDomainRoutes = new Elysia()
  .use(schedulesRoutes)
  .use(dailyScheduleRoutes)
  .use(pomodoroRoutes)
  .use(timeEntriesRoutes);
