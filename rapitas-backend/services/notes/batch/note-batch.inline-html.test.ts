/**
 * note-batch.inline-html.test
 *
 * `POST /notes/batch` stores a body stripped of disallowed inline HTML and
 * still refuses the old editor's HTML (allowed inline forms, design
 * note-markdown-format.md). Proves the batch path is wired to the strip.
 */
import { describe, it, expect } from 'bun:test';
import { seedStage1 } from '../../../tests/helpers/notes-stage1-seed';
import { createNotesBatch, type BatchItem } from './note-batch';

const item = (id: string, content: string): BatchItem => ({
  id,
  title: '締め',
  content,
  source: 'roadmap',
  taskIds: [102],
});

describe('a batch item body with inline HTML', () => {
  it('is stored with only the disallowed parts removed', async () => {
    const db = seedStage1();
    const [result] = await createNotesBatch(db.prisma as never, [
      item(
        'roadmap-11-9',
        '<span style="color:#E53935">赤</span><script>x</script><span onclick="y">z</span>',
      ),
    ]);
    expect(result).toMatchObject({ id: 'roadmap-11-9', status: 'created' });
    expect(db.find('note', { id: 'roadmap-11-9' })).toMatchObject({
      content: '<span style="color:#E53935">赤</span>z',
    });
  });

  it('is refused when it holds the old editor div', async () => {
    const db = seedStage1();
    const [result] = await createNotesBatch(db.prisma as never, [
      item('roadmap-11-8', '<span style="color:#E53935">a</span><div>b</div>'),
    ]);
    expect(result).toMatchObject({ id: 'roadmap-11-8', status: 'rejected' });
    expect(db.find('note', { id: 'roadmap-11-8' })).toBeUndefined();
  });
});
