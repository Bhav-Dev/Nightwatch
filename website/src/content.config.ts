import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { topics } from './lib/topics';

/**
 * Remedy pages: one Markdown file each in src/content/remedies. The file name is the URL
 * (/remedies/<file name>) and the key for the remedy's figures in src/data/community.ts.
 */
const remedies = defineCollection({
  loader: glob({ base: './src/content/remedies', pattern: '**/*.md' }),
  schema: z.object({
    /** The question the page answers, also its <h1> and title. */
    question: z.string(),
    /** The remedy's short name, as lists show it: "Mouth tape", "Side sleeping". */
    label: z.string(),
    /** For search results and link previews. */
    description: z.string(),
    /** Practical steps for trying it. The last step, a two-week test in the app, is added for you. */
    steps: z.array(z.string()).min(1),
    /** The "See a GP if" box. The usual warning signs are always shown; this adds the remedy's own caution. */
    caution: z.string().optional(),
    /** An Amazon affiliate link. The button only shows when this is set. */
    amazonUrl: z.string().optional(),
    /** Position among the home page's questions (1 is first). Leave out to keep it off the home page. */
    home: z.number().int().optional(),
  }),
});

/**
 * Articles: Markdown or MDX files in src/content/articles. MDX can use the chart and figure
 * components in src/components/article.
 */
const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    /** For search results and link previews. */
    description: z.string(),
    /** The line under the title. {points}, {peakHour}, {people} and {nights} are filled from the article's figures. */
    standfirst: z.string().optional(),
    topic: z.enum(topics),
    /** "planned" articles show on the index as coming soon, with no page of their own. */
    status: z.enum(['published', 'planned']).default('published'),
    date: z.coerce.date().optional(),
    readMinutes: z.number().int().optional(),
    featured: z.boolean().default(false),
    /** The picture on the article's card. */
    cover: z.enum(['drinks', 'cells', 'weather', 'weeks', 'hours', 'tests', 'month']),
    /** Which figures in src/data/community.ts the article uses, if any. */
    figures: z.enum(['alcohol']).optional(),
    /** Position among the home page's questions (1 is first). Leave out to keep it off the home page. */
    home: z.number().int().optional(),
    /** The question the home page shows for this article. */
    question: z.string().optional(),
  }),
});

export const collections = { remedies, articles };
