import { Global, Module } from '@nestjs/common';
import { Clock } from './clock';
import { DataScopeService } from './scope/data-scope.service';

/**
 * Cross-cutting services every feature module may inject.
 *
 * Global because data scoping is not a feature's own concern — any module that
 * lists records has to apply it, and threading it through imports would be
 * noise.
 */
@Global()
@Module({
  providers: [DataScopeService, Clock],
  exports: [DataScopeService, Clock],
})
export class CommonModule {}
