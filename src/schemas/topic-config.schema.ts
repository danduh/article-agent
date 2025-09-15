import { z } from 'zod';

// Model configuration schema
export const ModelConfigSchema = z.object({
  outline: z.string().min(1, 'Outline model is required'),
  draft: z.string().min(1, 'Draft model is required'),
  refine: z.string().min(1, 'Refine model is required'),
});

// Research configuration schema
export const ResearchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sources: z.array(z.string()).default(['duckduckgo']),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  min_sources: z.number().min(1).default(3),
  max_sources: z.number().min(1).default(10),
  freshness_days: z.number().min(1).optional(),
  required_keywords: z.array(z.string()).optional(),
});

// Outline configuration schema
export const OutlineConfigSchema = z.object({
  required_sections: z.array(z.string()).default(['Introduction', 'Conclusion']),
  max_sections: z.number().min(1).default(10),
  section_depth: z.number().min(1).max(6).default(3), // H1-H6
  include_subsections: z.boolean().default(true),
});

// SEO configuration schema
export const SEOConfigSchema = z.object({
  keywords: z.array(z.string()).min(1, 'At least one keyword is required'),
  keyword_density: z.string().regex(/^\d+(\.\d+)?-\d+(\.\d+)?%$/, 'Keyword density must be in format "1-2%" or "1.5-2.5%"').default('1-2%'),
  meta_title_length: z.object({
    min: z.number().min(10).default(30),
    max: z.number().max(100).default(60),
  }).default({ min: 30, max: 60 }),
  meta_description_length: z.object({
    min: z.number().min(50).default(120),
    max: z.number().max(200).default(160),
  }).default({ min: 120, max: 160 }),
  internal_links: z.object({
    min: z.number().min(0).default(2),
    max: z.number().min(0).default(10),
  }).default({ min: 2, max: 10 }),
  external_links: z.object({
    min: z.number().min(0).default(1),
    max: z.number().min(0).default(5),
  }).default({ min: 1, max: 5 }),
});

// Output configuration schema
export const OutputConfigSchema = z.object({
  formats: z.array(z.enum(['md', 'html', 'json'])).min(1, 'At least one output format is required'),
  include_metadata: z.boolean().default(true),
  include_citations: z.boolean().default(true),
  include_outline: z.boolean().default(true),
});

// Main topic configuration schema
export const TopicConfigSchema = z.object({
  id: z.string().min(1, 'Topic ID is required'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (e.g., 1.0.0)'),
  status: z.enum(['active', 'inactive', 'deprecated']).default('active'),
  title: z.string().min(1, 'Topic title is required'),
  description: z.string().optional(),
  audience: z.string().min(1, 'Target audience is required'),
  tone: z.enum(['formal', 'informal', 'neutral', 'conversational', 'academic', 'professional']).default('neutral'),
  reading_level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).default('B2'),
  length: z.string().regex(/^\d+-\d+$/, 'Length must be in format "min-max" (e.g., "1200-1500")'),
  language: z.string().min(2).max(5).default('en'), // ISO language codes
  models: ModelConfigSchema,
  research: ResearchConfigSchema,
  outline: OutlineConfigSchema,
  seo: SEOConfigSchema,
  output: OutputConfigSchema,
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  priority: z.number().min(1).max(10).default(5),
});

// Type exports
export type TopicConfig = z.infer<typeof TopicConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
export type OutlineConfig = z.infer<typeof OutlineConfigSchema>;
export type SEOConfig = z.infer<typeof SEOConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

// Validation helper functions
export const validateTopicConfig = (data: unknown): TopicConfig => {
  return TopicConfigSchema.parse(data);
};

export const validatePartialTopicConfig = (data: unknown): Partial<TopicConfig> => {
  return TopicConfigSchema.partial().parse(data);
};

// Schema for API responses
export const TopicConfigResponseSchema = z.object({
  success: z.boolean(),
  data: TopicConfigSchema.optional(),
  error: z.string().optional(),
  version: z.string().optional(),
});

export type TopicConfigResponse = z.infer<typeof TopicConfigResponseSchema>;

// Schema for topic listing
export const TopicListSchema = z.object({
  topics: z.array(
    TopicConfigSchema.pick({
      id: true,
      version: true,
      title: true,
      status: true,
      created_at: true,
      updated_at: true,
      tags: true,
      priority: true,
    })
  ),
  total: z.number(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

export type TopicList = z.infer<typeof TopicListSchema>;