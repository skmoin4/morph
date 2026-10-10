import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { MailModule } from './modules/mail/mail.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SettingsModule } from './modules/settings/settings.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { FilesModule } from './modules/files/files.module';
import { ClientsModule } from './modules/clients/clients.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { LeaveModule } from './modules/leave/leave.module';
import { TimeModule } from './modules/time/time.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { CostModule } from './modules/cost/cost.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RequestContextMiddleware } from './common/interceptors/request-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { FieldMaskingInterceptor } from './common/interceptors/field-masking.interceptor';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The monorepo keeps one .env at the root for both apps.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // The e2e suite signs in dozens of times in a few seconds, which the auth
      // limiter would (correctly) block. Rate limiting is exercised on its own
      // rather than fighting every other test.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    CommonModule,
    PrismaModule,
    MailModule,
    AuditModule,
    AuthModule,
    RbacModule,
    SettingsModule,
    EmployeesModule,
    FilesModule,
    ClientsModule,
    BookingsModule,
    ProjectsModule,
    AttendanceModule,
    LeaveModule,
    TimeModule,
    ExpensesModule,
    CostModule,
    DashboardModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttle, then authenticate (which also opens the tenant
    // scope), then check permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Runs last on the way out, so sensitive fields are stripped from every
    // response regardless of which endpoint produced it.
    { provide: APP_INTERCEPTOR, useClass: FieldMaskingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
