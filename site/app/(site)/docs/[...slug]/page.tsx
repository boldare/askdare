import type { Metadata } from 'next';
import Link from 'next/link';
import { editUrl, getPage, neighbours, slugs, titles } from '../_lib/content';

interface Props {
  readonly params: Promise<{ slug: string[] }>;
}

// Every page is built from docs/ at build time; there are no others.
export const dynamicParams = false;

export function generateStaticParams(): { slug: string[] }[] {
  return slugs().map((slug) => ({ slug: slug.split('/') }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPage((await params).slug.join('/'));
  return { title: `${page.title} · askdare docs`, description: page.description };
}

export default async function DocPage({ params }: Props) {
  const slug = (await params).slug.join('/');
  const page = await getPage(slug);
  const names = await titles();
  const { previous, next } = neighbours(slug);
  const contents = page.toc.filter((entry) => entry.id);
  return (
    <>
      <article className="d-article">
        {page.body}
        <footer className="d-foot">
          <a className="d-edit" href={editUrl(page.file)}>
            Edit this page on GitHub
          </a>
          {previous || next ? (
            <nav className="d-pager" aria-label="Previous and next page">
              {previous ? (
                <Link href={`/docs/${previous}`} rel="prev">
                  <small>Previous</small>
                  {names.get(previous)}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/docs/${next}`} rel="next">
                  <small>Next</small>
                  {names.get(next)}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </footer>
      </article>
      {contents.length > 1 ? (
        <aside className="d-toc" aria-labelledby="toc-title">
          <p id="toc-title">On this page</p>
          <ol>
            {contents.map((entry) => (
              <li key={entry.id} data-depth={entry.depth}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </>
  );
}
