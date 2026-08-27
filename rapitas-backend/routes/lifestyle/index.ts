// Routes Lifestyle barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { habitsRoutes } from './habits';
import { paidLeaveRoutes } from './paid-leave';

export { habitsRoutes } from './habits';
export { paidLeaveRoutes } from './paid-leave';

export const lifestyleDomainRoutes = new Elysia().use(habitsRoutes).use(paidLeaveRoutes);
