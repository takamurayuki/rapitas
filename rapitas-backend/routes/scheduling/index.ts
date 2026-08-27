// Routes Scheduling barrel export — 集約 + ドメイン単位マージ済みインスタンス
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
