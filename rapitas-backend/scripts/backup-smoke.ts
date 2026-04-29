import { runBackup, listBackups, readBackupStatus } from '../services/system/backup-service';
const r = await runBackup();
console.log('runBackup result:', JSON.stringify(r, null, 2));
console.log('listBackups:', listBackups().length, 'archives');
console.log('status:', readBackupStatus());
