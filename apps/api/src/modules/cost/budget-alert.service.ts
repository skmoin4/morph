import { Injectable, Logger } from '@nestjs/common';
import { burnPercent, planAlert, type HealthValue } from '@opsvera/shared';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Budget alerts: when approved hours push a project to 80 % or 100 % of its
 * hours budget, the people who watch its cost are told — once per crossing.
 *
 * Called after anything that changes a project's posted hours (a timesheet
 * approval or reopening, a manual labour adjustment). It reads the project as it
 * now stands, so it is safe to call more than once. The level is moved with a
 * compare-and-set, so two postings landing together alert once.
 */
@Injectable()
export class BudgetAlertService {
  private readonly logger = new Logger(BudgetAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  async evaluate(projectIds: string[]): Promise<void> {
    for (const projectId of new Set(projectIds)) {
      try {
        await this.evaluateOne(projectId);
      } catch (error) {
        // An alert must never undo the approval that triggered it.
        this.logger.error(`Budget check failed for ${projectId}: ${(error as Error).message}`);
      }
    }
  }

  private async evaluateOne(projectId: string) {
    const project = await this.prisma.scoped.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        projectCode: true,
        name: true,
        status: true,
        budgetHours: true,
        actualHours: true,
        budgetAlertLevel: true,
        health: true,
      },
    });
    if (!project) return;

    const actual = Number(project.actualHours);
    const budget = Number(project.budgetHours);
    const percent = burnPercent(actual, budget);
    const plan = planAlert({
      previousLevel: project.budgetAlertLevel,
      percent,
      currentHealth: project.health as HealthValue,
    });
    if (plan.level === project.budgetAlertLevel && plan.health === project.health) return;

    // Compare-and-set on the level we read: whoever wins the update sends the alert.
    const { count } = await this.prisma.scoped.project.updateMany({
      where: { id: projectId, budgetAlertLevel: project.budgetAlertLevel },
      data: { budgetAlertLevel: plan.level, health: plan.health },
    });
    if (count === 0 || plan.notify === null) return;

    await this.notify.toProjectHolders(
      'cost.view',
      projectId,
      plan.notify === 100 ? 'BUDGET_ALERT_100' : 'BUDGET_ALERT_80',
      {
        title:
          plan.notify === 100
            ? `${project.projectCode} has used all of its budget hours`
            : `${project.projectCode} has used ${Math.floor(percent ?? 80)}% of its budget hours`,
        body: `${actual.toLocaleString('en-IN')} of ${budget.toLocaleString('en-IN')} budgeted hours are consumed.`,
        linkUrl: `/projects/${projectId}?tab=cost`,
        entityType: 'Project',
        entityId: projectId,
      },
    );
  }
}
