import { prisma } from '../config/database';
import { findFallbackAgentConfig } from '../services/ai/agent-fallback';

const configs = await prisma.aIAgentConfig.findMany({ where: { isActive: true } });
console.log(`Active agent configs: ${configs.length}`);
for (const c of configs) {
  console.log(`  ${c.id}: ${c.name} (agentType=${c.agentType}, isDefault=${c.isDefault})`);
}

const sample = `ERROR: You've hit your usage limit. ... try again at 1:19 PM.`;
const fallback = await findFallbackAgentConfig(sample, 'codex');
if (fallback) {
  console.log(
    `Fallback choice: ${(fallback.agentConfig as any).name} (agentType=${(fallback.agentConfig as any).agentType})`,
  );
} else {
  console.log('No fallback available!');
}
process.exit(0);
