import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assignRoleSchema,
  createRoleSchema,
  roleListQuerySchema,
  setRolePermissionsSchema,
  updateRoleSchema,
  type AssignRoleInput,
  type CreateRoleInput,
  type RoleListQuery,
  type SetRolePermissionsInput,
  type UpdateRoleInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permission-catalogue')
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'Modules x actions grid plus the non-grid permission keys' })
  catalogue() {
    return this.roles.catalogue();
  }

  @Get()
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'List roles' })
  list(@Query(new ZodValidationPipe(roleListQuerySchema)) query: RoleListQuery) {
    return this.roles.list(query);
  }

  @Get(':id')
  @RequirePermissions('role.view')
  @ApiOperation({ summary: 'One role with its full permission matrix' })
  findOne(@Param('id') id: string) {
    return this.roles.findOne(id);
  }

  @Post()
  @RequirePermissions('role.create')
  @ApiOperation({ summary: 'Create a custom role' })
  create(
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('role.edit')
  @ApiOperation({ summary: 'Rename or deactivate a role' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.update(id, body, user);
  }

  @Put(':id/permissions')
  @RequirePermissions('role.edit')
  @ApiOperation({ summary: 'Replace a role permission matrix in one save' })
  setPermissions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setRolePermissionsSchema)) body: SetRolePermissionsInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.setPermissions(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('role.delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a custom role' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roles.remove(id, user);
  }

  @Post('assign')
  @RequirePermissions('role.edit')
  @HttpCode(204)
  @ApiOperation({ summary: 'Move a user onto a different role' })
  assign(
    @Body(new ZodValidationPipe(assignRoleSchema)) body: AssignRoleInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roles.assign(body.userId, body.roleId, user);
  }
}
