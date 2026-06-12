/**
 * Learning Goal Apply Handler
 *
 * Route handler for applying a generated learning plan to the task system:
 * creates a theme, tasks, and subtasks.
 */

import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { type GeneratedLearningPlan, buildTaskDescription } from '../learning-goal-helpers';

export const learningGoalApplyRoutes = new Elysia()
  // Apply learning plan to tasks (create theme, tasks, and subtasks)
  .post('/:id/apply', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);

    const goal = await prisma.learningGoal.findUnique({
      where: { id },
    });

    if (!goal) {
      return { error: 'Learning goal not found' };
    }

    if (!goal.generatedPlan) {
      return { error: 'No generated plan found. Please generate a plan first.' };
    }

    if (goal.isApplied) {
      return { error: 'This plan has already been applied.' };
    }

    const plan = JSON.parse(goal.generatedPlan as string) as GeneratedLearningPlan;

    // 1. Get learning category (create if absent)
    let categoryId = goal.categoryId;
    if (!categoryId) {
      const learningCategory = await prisma.category.findFirst({
        where: { mode: 'learning' },
      });
      categoryId = learningCategory?.id ?? null;
    }

    // 2. Create theme
    const theme = await prisma.theme.create({
      data: {
        name: plan.themeName || goal.title,
        description: plan.themeDescription || goal.description || `学習目標: ${goal.title}`,
        color: '#8B5CF6',
        isDevelopment: false,
        ...(categoryId && { categoryId }),
      },
    });

    // 3. Create tasks per phase
    const createdTasks = [];
    let currentDate = new Date();

    for (const phase of plan.phases) {
      const phaseEndDate = new Date(currentDate);
      phaseEndDate.setDate(phaseEndDate.getDate() + phase.days);

      for (const taskDef of phase.tasks) {
        const task = await prisma.task.create({
          data: {
            title: taskDef.title,
            description: buildTaskDescription(phase.name, taskDef.description, goal.title),
            status: 'todo',
            priority: taskDef.priority || 'medium',
            estimatedHours: taskDef.estimatedHours || null,
            dueDate: phaseEndDate,
            subject: goal.title,
            themeId: theme.id,
          },
        });

        // Create subtasks if defined (preserve order)
        if (taskDef.subtasks && taskDef.subtasks.length > 0) {
          const hoursPerDay = Math.min(goal.dailyHours, 8); // Max study hours per day
          let accumulatedDays = 0;

          for (let i = 0; i < taskDef.subtasks.length; i++) {
            const sub = taskDef.subtasks[i];
            const subtaskDays = Math.ceil((sub.estimatedHours || 0) / hoursPerDay);

            // Calculate subtask due date (within parent deadline)
            const subtaskDueDate = new Date(currentDate);
            subtaskDueDate.setDate(subtaskDueDate.getDate() + accumulatedDays + subtaskDays);

            // Clamp due date to not exceed parent deadline
            const adjustedDueDate = subtaskDueDate > phaseEndDate ? phaseEndDate : subtaskDueDate;

            await prisma.task.create({
              data: {
                title: `${i + 1}. ${sub.title}`,
                description: sub.description || null,
                status: 'todo',
                priority: taskDef.priority || 'medium',
                estimatedHours: sub.estimatedHours || null,
                parentId: task.id,
                themeId: theme.id,
                subject: goal.title,
                dueDate: adjustedDueDate,
                createdAt: new Date(Date.now() + i * 1000), // stagger createdAt to preserve order
              },
            });

            accumulatedDays += subtaskDays;
          }
        }

        createdTasks.push(task);
      }

      currentDate = phaseEndDate;
    }

    // 4. Mark learning goal as applied
    await prisma.learningGoal.update({
      where: { id },
      data: { isApplied: true, themeId: theme.id },
    });

    return {
      success: true,
      themeId: theme.id,
      themeName: theme.name,
      createdTaskCount: createdTasks.length,
    };
  });
