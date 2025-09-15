import { z } from 'zod';

// Citation schema
export const CitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  domain: z.string(),
  excerpt: z.string().optional(),
  date: z.string().optional(),
  relevance_score: z.number().min(0).max(1).optional(),
});

// Section schema
export const SectionSchema = z.object({
  id: z.string(),
  level: z.number().min(1).max(3),
  title: z.string(),
  content: z.string(),
  word_count: z.number(),
  citations: z.array(z.string()).optional(),
});

// SEO metadata schema
export const SEOMetadataSchema = z.object({
  title: z.string(),
  meta_description: z.string(),
  keywords: z.array(z.string()),
  keyword_density: z.record(z.number()),
  internal_links: z.array(z.string()).optional(),
  external_links: z.array(z.string()).optional(),
});

// Article schema
export const ArticleSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  topic_version: z.string(),
  title: z.string(),
  sections: z.array(SectionSchema),
  citations: z.array(CitationSchema),
  seo_metadata: SEOMetadataSchema,
  word_count: z.number(),
  reading_time_minutes: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// Run metadata schema
export const RunMetadataSchema = z.object({
  run_id: z.string(),
  topic_id: z.string(),
  topic_version: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  stages: z.array(z.object({
    name: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    started_at: z.string().datetime().optional(),
    completed_at: z.string().datetime().optional(),
    error: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  })),
  models_used: z.object({
    outline: z.string().optional(),
    draft: z.string().optional(),
    refine: z.string().optional(),
  }),
  error: z.string().optional(),
  output_files: z.array(z.string()).optional(),
});

export type Citation = z.infer<typeof CitationSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type SEOMetadata = z.infer<typeof SEOMetadataSchema>;
export type Article = z.infer<typeof ArticleSchema>;
export type RunMetadata = z.infer<typeof RunMetadataSchema>;