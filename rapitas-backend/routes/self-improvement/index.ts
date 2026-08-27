// Routes Self-Improvement barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { missSignaturesRoutes } from './miss-signatures-routes';

export { missSignaturesRoutes } from './miss-signatures-routes';

export const selfImprovementDomainRoutes = new Elysia().use(missSignaturesRoutes);
