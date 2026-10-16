/**
 * learning-goals (deprecated route)
 *
 * The learning-goal feature merged with exam goals into the unified learning
 * roadmap — permanently redirect old links there.
 */
import { redirect } from 'next/navigation';

export default function LearningGoalsRedirect() {
  redirect('/learning-roadmap');
}
