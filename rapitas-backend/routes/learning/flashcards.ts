/**
 * Flashcards API Routes
 *
 * Barrel re-export that composes the CRUD routes and AI-generation routes
 * into the single `flashcardsRoutes` Elysia instance expected by the router.
 *
 * Not responsible for individual handler logic; see flashcards/ subdirectory.
 */

import { Elysia } from 'elysia';
import { flashcardCrudRoutes } from './flashcards/crud-routes';
import { flashcardAiGenerateRoutes } from './flashcards/ai-generate-routes';

export const flashcardsRoutes = new Elysia()
  .use(flashcardCrudRoutes)
  .use(flashcardAiGenerateRoutes);
