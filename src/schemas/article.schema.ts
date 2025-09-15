import { z } from 'zod';

// Citation schema
export const CitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  domain: z.string(),
  snippet: z.string(),
  relevance_score: z.number().min(0).max(1).optional(),
  retrieved_at: z.string().datetime(),
});

// Section schema for article outline/content
export const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  level: z.number().min(1).max(6), // H1-H6
  content: z.string().optional(),
  subsections: z.array(z.lazy(() => SectionSchema)).optional(),
  citations: z.array(z.string()).optional(), // Citation IDs
  word_count: z.number().min(0).optional(),
});

// Article outline schema
export const ArticleOutlineSchema = z.object({
  title: z.string(),
  sections: z.array(SectionSchema),
  estimated_word_count: z.number().min(0),
  created_at: z.string().datetime(),
});

// SEO metadata schema
export const SEOMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  canonical_url: z.string().url().optional(),
  og_title: z.string().optional(),
  og_description: z.string().optional(),
  og_image: z.string().url().optional(),
  twitter_title: z.string().optional(),
  twitter_description: z.string().optional(),
  twitter_image: z.string().url().optional(),
});

// Article content schema
export const ArticleContentSchema = z.object({
  title: z.string(),
  content: z.string(), // Full article content in markdown
  sections: z.array(SectionSchema),
  word_count: z.number().min(0),
  reading_time_minutes: z.number().min(0),
  language: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
});

// Full article schema
export const ArticleSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  topic_version: z.string(),
  status: z.enum(['draft', 'review', 'published', 'archived']),
  outline: ArticleOutlineSchema,
  content: ArticleContentSchema,
  seo: SEOMetadataSchema,
  citations: z.array(CitationSchema),
  metadata: z.object({
    models_used: z.object({
      outline: z.string(),
      draft: z.string(),
      refine: z.string(),
    }),
    generation_time_ms: z.number().min(0),
    api_calls: z.number().min(0),
    tokens_used: z.number().min(0).optional(),
    cost_usd: z.number().min(0).optional(),
  }),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
});

// Research result schema
export const ResearchResultSchema = z.object({
  query: z.string(),
  sources: z.array(CitationSchema),
  summary: z.string(),
  key_points: z.array(z.string()),
  retrieved_at: z.string().datetime(),
});

// Generation stage schema for tracking progress
export const GenerationStageSchema = z.object({
  stage: z.enum(['research', 'outline', 'draft', 'refine', 'export']),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  error: z.string().optional(),
  data: z.any().optional(), // Stage-specific data
});

// Article generation run schema
export const ArticleRunSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  topic_version: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  stages: z.array(GenerationStageSchema),
  article_id: z.string().optional(), // Set when article is generated
  error: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
});

// Type exports
export type Citation = z.infer<typeof CitationSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ArticleOutline = z.infer<typeof ArticleOutlineSchema>;
export type SEOMetadata = z.infer<typeof SEOMetadataSchema>;
export type ArticleContent = z.infer<typeof ArticleContentSchema>;
export type Article = z.infer<typeof ArticleSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type GenerationStage = z.infer<typeof GenerationStageSchema>;
export type ArticleRun = z.infer<typeof ArticleRunSchema>;

// Validation helper functions
export const validateArticle = (data: unknown): Article => {
  return ArticleSchema.parse(data);
};

export const validateArticleOutline = (data: unknown): ArticleOutline => {
  return ArticleOutlineSchema.parse(data);
};

export const validateResearchResult = (data: unknown): ResearchResult => {
  return ResearchResultSchema.parse(data);
};