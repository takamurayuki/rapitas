import { __resetCooldowns, listActiveCooldowns } from '../services/ai/provider-cooldown';
console.log('Active before:', listActiveCooldowns());
__resetCooldowns();
console.log('Cleared. After:', listActiveCooldowns());
