import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ArticleController } from './controllers/article.controller';
import { TopicLoaderService } from './services/topic-loader/topic-loader.service';
import { ResearchAgent } from './agents/research/research.agent';
import { OutlineAgent } from './agents/outline/outline.agent';
import { DraftAgent } from './agents/draft/draft.agent';
import { RefineSEOAgent } from './agents/refine/refine-seo.agent';
import { ExporterService } from './services/exporter/exporter.service';
import { StorageService } from './services/storage/storage.service';
import { OrchestratorService } from './services/orchestrator/orchestrator.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [ArticleController],
  providers: [
    TopicLoaderService,
    ResearchAgent,
    OutlineAgent,
    DraftAgent,
    RefineSEOAgent,
    ExporterService,
    StorageService,
    OrchestratorService,
  ],
})
export class AppModule {}