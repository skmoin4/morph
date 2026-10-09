import { z } from 'zod';
import {
  MilestoneStatus,
  ProjectHealth,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '../constants/enums';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

// ---------------------------------------------------------------------------
// Projects
//
// A project is never created here: it exists because a booking was confirmed.
// What can change afterwards is the plan — dates, manager, status, health.
// ---------------------------------------------------------------------------

export const projectListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ProjectStatus).optional(),
  health: z.nativeEnum(ProjectHealth).optional(),
  clientId: idSchema.optional(),
  officeId: idSchema.optional(),
  projectTypeId: idSchema.optional(),
  projectManagerId: idSchema.optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(5000).nullable(),
    startDate: dateOnlySchema.nullable(),
    endDate: dateOnlySchema.nullable(),
    projectManagerId: idSchema.nullable(),
    health: z.nativeEnum(ProjectHealth),
  })
  .partial()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/** Status changes are their own action: cancelling needs a reason and is audited. */
export const changeProjectStatusSchema = z
  .object({
    status: z.nativeEnum(ProjectStatus),
    reason: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.status !== ProjectStatus.CANCELLED || (v.reason ?? '').length >= 5, {
    message: 'Say why the project is being cancelled',
    path: ['reason'],
  });
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;

/**
 * Allowed status moves. Completed and cancelled projects can be reopened to
 * ACTIVE (people do mark things done too early), but not jump sideways.
 */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['ACTIVE'],
  CANCELLED: ['ACTIVE'],
};

export function canMoveProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const addProjectMemberSchema = z.object({
  employeeId: idSchema,
  roleOnProject: z.string().trim().max(120).optional().nullable(),
  allocationPercent: z.coerce.number().int().min(1).max(100).default(100),
  joinedOn: dateOnlySchema.optional().nullable(),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = z
  .object({
    roleOnProject: z.string().trim().max(120).nullable(),
    allocationPercent: z.coerce.number().int().min(1).max(100),
  })
  .partial();
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const milestoneSchema = z.object({
  name: z.string().trim().min(2, 'Name the milestone').max(200),
  description: z.string().trim().max(3000).optional().nullable(),
  dueDate: dateOnlySchema,
  status: z.nativeEnum(MilestoneStatus).optional(),
  value: moneySchema.optional().nullable(),
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;

export const updateMilestoneSchema = milestoneSchema.partial();
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskBase = z.object({
  title: z.string().trim().min(2, 'Give the task a title').max(250),
  description: z.string().trim().max(10_000).optional().nullable(),
  milestoneId: idSchema.optional().nullable(),
  assigneeId: idSchema.optional().nullable(),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.MEDIUM),
  startDate: dateOnlySchema.optional().nullable(),
  dueDate: dateOnlySchema.optional().nullable(),
  estimatedHours: z.coerce.number().min(0).max(100_000).optional().nullable(),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
});

export const createTaskSchema = taskBase.refine(
  (v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate,
  { message: 'Due date must be on or after the start date', path: ['dueDate'] },
);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = taskBase
  .partial()
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    message: 'Due date must be on or after the start date',
    path: ['dueDate'],
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Drag-and-drop on the Kanban board: a column and a place in it. */
export const moveTaskSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  /** Drop the card just above this one; omitted = bottom of the column. */
  beforeTaskId: idSchema.optional().nullable(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

export const taskListQuerySchema = paginationQuerySchema.extend({
  projectId: idSchema.optional(),
  milestoneId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  /** "mine" = assigned to the caller. */
  mine: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const taskCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment').max(5000),
});
export type TaskCommentInput = z.infer<typeof taskCommentSchema>;

// ---------------------------------------------------------------------------
// Task attachments
// ---------------------------------------------------------------------------

/**
 * Working files that travel with a task: drawings, models, sheets, photos.
 * Executables and scripts are refused; downloads are always served as
 * attachments, never rendered in the app's origin.
 */
export const TASK_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.dwg',
  '.dxf',
  '.ifc',
  '.rvt',
  '.zip',
] as const;

export const TASK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export function validateTaskAttachment(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; message: string } {
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();

  if (!(TASK_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      message: `"${file.name}" is not an accepted file type. Drawings, models, documents, sheets and images are fine.`,
    };
  }
  if (file.size === 0) return { ok: false, message: 'That file is empty.' };
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        TASK_ATTACHMENT_MAX_BYTES / 1024 / 1024
      } MB.`,
    };
  }
  return { ok: true };
}
