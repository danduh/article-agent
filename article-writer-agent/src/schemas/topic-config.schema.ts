import { z } from 'zod';

// Model configuration schema
export const ModelConfigSchema = z.object({
  outline: z.string().describe('Model to use for outline generation'),
  draft: z.string().describe('Model to use for draft writing'),
  refine: z.string().describe('Model to use for refinement and SEO'),
});

// Research configuration schema
export const ResearchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sources: z.array(z.string()).default(['duckduckgo']),
  allowlist: z.array(z.string()).optional(),
  blocklist: z.array(z.string()).optional(),
  min_sources: z.number().min(1).default(3),
  max_sources: z.number().min(1).default(10),
  freshness_days: z.number().optional(),
});

// Outline configuration schema
export const OutlineConfigSchema = z.object({
  required_sections: z.array(z.string()).min(1),
  max_depth: z.number().min(1).max(3).default(3),
  min_sections: z.number().min(1).default(3),
  max_sections: z.number().min(1).default(10),
});

// SEO configuration schema
export const SEOConfigSchema = z.object({
  keywords: z.array(z.string()).min(1),
  keyword_density: z.string().regex(/^\d+-\d+%$/),
  meta_description_length: z.object({
    min: z.number().default(120),
    max: z.number().default(160),
  }).optional(),
  internal_links: z.number().optional(),
  external_links: z.number().optional(),
});

// Output configuration schema
export const OutputConfigSchema = z.object({
  formats: z.array(z.enum(['md', 'html', 'json'])).min(1),
  include_metadata: z.boolean().default(true),
  include_citations: z.boolean().default(true),
});

// Main topic configuration schema
export const TopicConfigSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['active', 'draft', 'deprecated']),
  title: z.string().min(1),
  description: z.string().optional(),
  audience: z.string(),
  tone: z.enum(['formal', 'neutral', 'casual', 'professional', 'academic']),
  reading_level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  length: z.string().regex(/^\d+-\d+$/),
  models: ModelConfigSchema,
  research: ResearchConfigSchema,
  outline: OutlineConfigSchema,
  seo: SEOConfigSchema,
  output: OutputConfigSchema,
  custom_instructions: z.string().optional(),
  terminology: z.record(z.string()).optional(),
});

export type TopicConfig = z.infer<typeof TopicConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
export type OutlineConfig = z.infer<typeof OutlineConfigSchema>;
export type SEOConfig = z.infer<typeof SEOConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;