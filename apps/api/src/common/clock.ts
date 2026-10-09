import { Injectable } from '@nestjs/common';

/**
 * The only place the application asks what time it is.
 *
 * Attendance is entirely about *when* — a punch at 09:41 is late, at 09:40 it
 * is not — so tests need to set the clock. Services take `Clock` instead of
 * calling `new Date()`, and a test replaces it.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
