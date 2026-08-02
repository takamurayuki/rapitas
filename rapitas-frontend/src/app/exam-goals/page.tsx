/**
 * exam-goals (deprecated route)
 *
 * The exam-goal feature merged with learning goals into the unified learning
 * roadmap — permanently redirect old links there.
 */
import { redirect } from 'next/navigation';

export default function ExamGoalsRedirect() {
  redirect('/learning-roadmap');
}
