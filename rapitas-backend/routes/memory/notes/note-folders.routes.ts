/**
 * Note Folders Routes
 *
 * Memo folders over HTTP (design §2.2 API table, §2.3): list, create, rename /
 * reorder, delete. Everything is inside the request's workspace; another
 * workspace's folder is the same 404 as a missing one.
 *
 * Not responsible for moving notes into a folder — that is `placement` on
 * `PUT /notes/:id`.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import {
  MAX_FOLDER_NAME,
  NoteFolderError,
  createNoteFolder,
  deleteNoteFolder,
  listNoteFolders,
  updateNoteFolder,
} from '../../../services/notes/folders/note-folders';
import { isValidEntityId } from '../../../utils/common/id-validation';

type StatusSetter = { status?: number | string };

function refusal(error: unknown, set: StatusSetter) {
  if (error instanceof NoteFolderError) {
    set.status = error.status;
    return { success: false, error: error.code };
  }
  throw error;
}

const nameField = t.String({ minLength: 1, maxLength: MAX_FOLDER_NAME * 4 });
const sortOrderField = t.Integer({ minimum: -1_000_000, maximum: 1_000_000 });

export const noteFoldersRoutes = new Elysia({ prefix: '/note-folders' })
  .get('/', async () => ({ success: true, folders: await listNoteFolders(prisma) }))

  .post(
    '/',
    async ({ body, set }) => {
      try {
        return { success: true, folder: await createNoteFolder(prisma, body) };
      } catch (error) {
        return refusal(error, set);
      }
    },
    { body: t.Object({ name: nameField, sortOrder: t.Optional(sortOrderField) }) },
  )

  .patch(
    '/:id',
    async ({ params, body, set }) => {
      if (!isValidEntityId(params.id)) {
        set.status = 400;
        return { success: false, error: 'invalid_folder_id' };
      }
      try {
        return { success: true, folder: await updateNoteFolder(prisma, Number(params.id), body) };
      } catch (error) {
        return refusal(error, set);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ name: t.Optional(nameField), sortOrder: t.Optional(sortOrderField) }),
    },
  )

  .delete(
    '/:id',
    async ({ params, set }) => {
      if (!isValidEntityId(params.id)) {
        set.status = 400;
        return { success: false, error: 'invalid_folder_id' };
      }
      try {
        const movedToUnclassified = await deleteNoteFolder(prisma, Number(params.id));
        return { success: true, movedToUnclassified };
      } catch (error) {
        return refusal(error, set);
      }
    },
    { params: t.Object({ id: t.String() }) },
  );

export default noteFoldersRoutes;
