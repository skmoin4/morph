import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  clientContactSchema,
  clientListQuerySchema,
  createClientSchema,
  updateClientSchema,
  type ClientContactInput,
  type ClientListQuery,
  type CreateClientInput,
  type UpdateClientInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ClientsService } from './clients.service';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('client.view')
  list(@Query(new ZodValidationPipe(clientListQuerySchema)) query: ClientListQuery) {
    return this.clients.list(query);
  }

  @Get(':id')
  @RequirePermissions('client.view')
  @ApiOperation({ summary: 'Client with contacts and recent bookings' })
  findOne(@Param('id') id: string) {
    return this.clients.findOne(id);
  }

  @Post()
  @RequirePermissions('client.create')
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.create(body as never, user);
  }

  @Patch(':id')
  @RequirePermissions('client.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.update(id, body as never, user);
  }

  @Post(':id/contacts')
  @RequirePermissions('client.edit')
  addContact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(clientContactSchema)) body: ClientContactInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.addContact(id, body as never, user);
  }

  @Delete('contacts/:contactId')
  @RequirePermissions('client.edit')
  @HttpCode(204)
  removeContact(@Param('contactId') contactId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.removeContact(contactId, user);
  }

  @Delete(':id')
  @RequirePermissions('client.delete')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.remove(id, user);
  }
}
