import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnv } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const env = validateEnv(process.env);
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Express only believes X-Forwarded-For when told how many proxies to trust.
  if (env.TRUST_PROXY > 0) app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({ origin: env.corsOrigins, credentials: true });
  app.setGlobalPrefix(env.API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
  // No global ValidationPipe: every payload is parsed by a Zod schema from
  // @opsvera/shared through ZodValidationPipe, so the API and the web form
  // validate against exactly the same rules.
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('OPSVERA API')
    .setDescription('Phase 1 — booking to live project cost.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(env.API_PORT);
  logger.log(`API on http://localhost:${env.API_PORT}${env.API_PREFIX}`);
  logger.log(`Swagger on http://localhost:${env.API_PORT}/api/docs`);
}

void bootstrap();
