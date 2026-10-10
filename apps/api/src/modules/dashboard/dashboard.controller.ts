import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { dashboardQuerySchema, type DashboardQuery } from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DataScope } from '@opsvera/shared';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ExecutiveService } from './executive.service';
import { ManagerService } from './manager.service';
import { MyDayService } from './my-day.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly executive: ExecutiveService,
    private readonly manager: ManagerService,
    private readonly myDay: MyDayService,
    private readonly scope: DataScopeService,
  ) {}

  @Get('home')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Which dashboards this person has, and which one is their home' })
  home(@CurrentUser() user: AuthenticatedUser) {
    const wide = this.scope.scopeFor(user, 'dashboard.view') === DataScope.ALL;
    const approves = [
      'timesheet.approve',
      'leave.approve',
      'expense.approve',
      'attendance.approve',
    ].some((k) => user.permissions.has(k));
    const sees = [
      'booking.view',
      'project.view',
      'cost.view',
      'attendance.view',
      'expense.view',
    ].some((k) => user.permissions.has(k));
    const kind: 'EXECUTIVE' | 'MANAGER' | 'MY_DAY' =
      wide && sees ? 'EXECUTIVE' : approves ? 'MANAGER' : 'MY_DAY';
    return {
      kind,
      dashboards: [
        ...(kind === 'EXECUTIVE' ? ['EXECUTIVE'] : []),
        ...(kind === 'MANAGER' ? ['MANAGER'] : []),
        ...(user.employeeId ? ['MY_DAY'] : []),
      ],
    };
  }

  @Get('executive')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'The executive command center, within the caller’s data scope' })
  executiveView(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.executive.executive(query, user);
  }

  @Get('manager')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Team today, what is waiting on me, my projects' })
  managerView(@CurrentUser() user: AuthenticatedUser) {
    return this.manager.manager(user);
  }

  @Get('my-day')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'My day: tasks, hours, leave, what needs me' })
  myDayView(@CurrentUser() user: AuthenticatedUser) {
    return this.myDay.myDay(user);
  }
}
