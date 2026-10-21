/**
 * Turns a build into a preview that works from any folder, such as a Claude Artifact:
 * every root-relative link and asset path becomes relative, and routes point at their
 * index.html. The real site does not need this; Vercel serves dist/ as it is.
 *
 *   node scripts/relative-links.mjs <build dir> [--title "Page name"]
 *
 * The home page is written without its doctype, html, head and body tags, because the Artifact
 * host wraps the page in its own document. --title replaces the home page's title, which names
 * the Artifact. Astro's _astro/ folder moves to assets/, since the host reserves names that
 * start with an underscore.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const dir = args[0];
const titleIndex = args.indexOf('--title');
const title = titleIndex > -1 ? args[titleIndex + 1] : undefined;
if (!dir) {
  console.error('Usage: node scripts/relative-links.mjs <build dir> [--title "Page name"]');
  process.exit(1);
}

const files = (function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
})(dir);

/** Where a file ends up in the preview. */
const moved = (path) => path.replace(/^_astro\//, 'assets/');

/** A root-relative URL as a path relative to the file at `from` (its place in the preview). */
function rel(url, from) {
  const [, path, suffix = ''] = url.match(/^([^?#]*)(.*)$/);
  const last = path.split('/').pop();
  const target = moved(extname(last) ? path.slice(1) : `${path.replace(/^\/|\/$/g, '')}/index.html`.replace(/^\//, ''));
  if (target === from) return suffix || posix.basename(from);
  return posix.relative(posix.dirname(from), target) + suffix;
}

let changed = 0;
for (const file of files) {
  const ext = extname(file);
  if (ext !== '.html' && ext !== '.css') continue;
  const from = moved(relative(dir, file).split(sep).join('/'));
  let text = readFileSync(file, 'utf8');
  const before = text;

  // href="/…", src="/…" and the like, but not protocol-relative "//host" URLs.
  text = text.replace(/\b(href|src|poster|action)="(\/(?!\/)[^"]*)"/g, (_, attr, url) => `${attr}="${rel(url, from)}"`);
  text = text.replace(/\bsrcset="([^"]*)"/g, (_, set) =>
    `srcset="${set.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g, (m, lead, url) => lead + rel(url, from))}"`,
  );
  // CSS url(/…), quoted or not, in stylesheets and inline styles.
  text = text.replace(/url\((['"]?)(\/(?!\/)[^'")]+)\1\)/g, (_, q, url) => `url(${q}${rel(url, from)}${q})`);

  if (from === 'index.html') {
    if (title) text = text.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    text = text
      .replace(/<!doctype html>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<\/?head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '')
      .replace(/<meta charset="[^"]*">/i, '')
      .replace(/<meta name="viewport"[^>]*>/i, '')
      // The side gutters use max(gutter, env(safe-area-inset-*)), so the page can run edge to edge.
      .replace(/(<title>[^<]*<\/title>)/, '$1<meta name="claude:viewport-fit-sides" content="cover">')
      .trim();
  }

  if (text !== before) {
    writeFileSync(file, text);
    changed += 1;
  }
  const left = text.match(/\b(?:href|src)="\/(?!\/)[^"]*"/g);
  if (left) console.warn(`${from}: still root-relative: ${left.join(' ')}`);
}
if (existsSync(join(dir, '_astro'))) renameSync(join(dir, '_astro'), join(dir, 'assets'));
console.log(`Rewrote ${changed} files in ${dir}.`);
