import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  
  // Enable validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS if needed
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = configService.get<number>('PORT', 3000);
  
  await app.listen(port);
  
  logger.log(`🚀 Article Agent API is running on: http://localhost:${port}`);
  logger.log(`📚 Topic source: ${configService.get('TOPIC_CONFIG_SOURCE', 'local')}`);
  logger.log(`💾 Storage path: ${configService.get('STORAGE_PATH', './storage')}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application:', error);
  process.exit(1);
});