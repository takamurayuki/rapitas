import { Elysia } from 'elysia';
import { setupRoutes } from '../routes/system/setup';
const app = new Elysia().use(setupRoutes);
const res = await app.handle(new Request('http://localhost/system/setup/status'));
console.log('status:', res.status);
console.log(JSON.stringify(await res.json(), null, 2));
