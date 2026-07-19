import { z } from "zod";

export const createNewsItemRequestSchema = z
  .object({
    external_id: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(300),
    url: z.string().trim().url().max(2048),
    summary: z.string().trim().min(1).max(2000),
    source_name: z.string().trim().min(1).max(160),
    published_at: z.string().trim().datetime({ offset: true }),
  })
  .strict();

export type CreateNewsItemRequest = z.infer<typeof createNewsItemRequestSchema>;

export interface NewsArticleResponse {
  id: number;
  external_id: string;
  title: string;
  url: string;
  summary: string;
  source_name: string;
  published_at: string;
  created_at: string;
}

export interface CreateNewsItemResponse {
  article: NewsArticleResponse;
}

export interface ListNewsResponse {
  has_more: boolean;
  articles: NewsArticleResponse[];
}
