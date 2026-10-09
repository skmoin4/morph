import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Pill, StatusPill, type PillTone } from '../../components/ui/Pill';
import { HEALTH_LABEL, STATUS_LABEL, type ProjectHealth, type ProjectStatus } from './useProjects';
import { PRIORITY_LABEL, type TaskPriority } from './useTasks';

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  return <StatusPill status={status} label={STATUS_LABEL[status]} />;
}

/** Health only means something while the project is live. */
export function HealthPill({ health, status }: { health: ProjectHealth; status?: ProjectStatus }) {
  if (status && status !== 'ACTIVE') return null;
  return <StatusPill status={health} label={HEALTH_LABEL[health]} />;
}

const PRIORITY_TONE: Record<TaskPriority, PillTone> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

const PRIORITY_ICON = {
  LOW: <ArrowDown />,
  MEDIUM: <Minus />,
  HIGH: <ArrowUp />,
  URGENT: <AlertTriangle />,
} as const;

export function PriorityPill({ priority }: { priority: TaskPriority }) {
  return (
    <Pill tone={PRIORITY_TONE[priority]} icon={PRIORITY_ICON[priority]}>
      {PRIORITY_LABEL[priority]}
    </Pill>
  );
}
