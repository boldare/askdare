import type { Metadata } from 'next';
import Link from 'next/link';
import { getPage, NAV } from './_lib/content';

export const metadata: Metadata = {
  title: 'askdare docs',
  description:
    'Add an AI chat to any website with a Next.js app: setup, configuration, embedding, styling, deployment and the reference.',
};

export default async function DocsIndex() {
  const groups = await Promise.all(
    NAV.map(async (group) => ({
      title: group.title,
      pages: await Promise.all(group.pages.map((slug) => getPage(slug))),
    })),
  );
  return (
    <article className="d-article d-index">
      <h1>askdare documentation</h1>
      <p className="d-lead">
        askdare serves an AI chat from your Next.js app: one route, one script tag, on the official
        OpenAI SDK. New here? Start with <Link href="/docs/getting-started">Getting started</Link>.
        It takes about 15 minutes.
      </p>
      {groups.map((group) => (
        <section key={group.title} aria-labelledby={`group-${group.title}`}>
          <h2 id={`group-${group.title}`}>{group.title}</h2>
          <ul className="d-cards">
            {group.pages.map((page) => (
              <li key={page.slug}>
                <Link href={`/docs/${page.slug}`}>
                  <strong>{page.title}</strong>
                  <span>{page.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
