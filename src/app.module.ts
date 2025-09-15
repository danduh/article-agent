import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TopicLoaderService } from './services/topic-loader.service';
import { ArticleOrchestrator } from './services/article-orchestrator.service';
import { ResearchAgent } from './agents/research.agent';
import { OutlineAgent } from './agents/outline.agent';
import { DraftAgent } from './agents/draft.agent';
import { SEORefineAgent } from './agents/seo-refine.agent';
import { ExporterService } from './services/exporter.service';
import { StorageService } from './services/storage.service';
import { GovernanceService } from './services/governance.service';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  controllers: [AppController],
  providers: [
    TopicLoaderService,
    ArticleOrchestrator,
    ResearchAgent,
    OutlineAgent,
    DraftAgent,
    SEORefineAgent,
    ExporterService,
    StorageService,
    GovernanceService,
  ],
})
export class AppModule {}