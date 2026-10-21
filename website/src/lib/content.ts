import { type CollectionEntry, getCollection } from 'astro:content';

import { alcohol, alcoholFindings } from '../data/community';
import { count } from './format';

type Article = CollectionEntry<'articles'>;

/** The figures an article's text can use as {tokens}. */
function figuresFor(entry: Article): Record<string, string | number> {
  if (entry.data.figures === 'alcohol') {
    const f = alcoholFindings();
    return { points: f.points, peakHour: f.peakHour, people: count(alcohol.people), nights: count(alcohol.nights) };
  }
  return {};
}

/** Replaces {tokens} with the article's figures. */
export function fill(text: string, entry: Article): string {
  const values = figuresFor(entry);
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

/** An article's title, with "What N nights say" added when it has figures behind it. */
export function articleTitle(entry: Article): string {
  return entry.data.figures === 'alcohol' ? `${entry.data.title} What ${count(alcohol.nights)} nights say` : entry.data.title;
}

/** Published articles, newest first. */
export async function publishedArticles(): Promise<Article[]> {
  const all = await getCollection('articles', (a) => a.data.status === 'published');
  return all.sort((a, b) => (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0));
}

/** Every article for the index: published first (newest first), then the ones still to come. */
export async function allArticles(): Promise<Article[]> {
  const all = await getCollection('articles');
  return all.sort((a, b) => {
    if (a.data.status !== b.data.status) return a.data.status === 'published' ? -1 : 1;
    return (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0) || a.data.title.localeCompare(b.data.title);
  });
}

export interface Question {
  question: string;
  href: string;
  order: number;
}

/** The questions the home page lists: remedies and articles that set `home`. */
export async function homeQuestions(): Promise<Question[]> {
  const remedies = await getCollection('remedies', (r) => r.data.home !== undefined);
  const articles = await getCollection('articles', (a) => a.data.home !== undefined && a.data.status === 'published');
  const questions: Question[] = [
    ...remedies.map((r) => ({ question: r.data.question, href: `/remedies/${r.id}`, order: r.data.home ?? 99 })),
    ...articles.map((a) => ({ question: a.data.question ?? a.data.title, href: `/articles/${a.id}`, order: a.data.home ?? 99 })),
    { question: 'When should I talk to a GP about snoring?', href: '/when-to-see-a-gp', order: 6 },
  ];
  return questions.sort((a, b) => a.order - b.order);
}
