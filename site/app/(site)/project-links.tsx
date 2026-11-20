export const GITHUB_URL = 'https://github.com/boldare/askdare';
export const NPM_URL = 'https://www.npmjs.com/package/@boldare/askdare';

/** The GitHub mark, from Primer Octicons (MIT). */
export function GitHubIcon() {
  return (
    <svg className="project-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}

/** The npm logo, from Simple Icons (CC0). */
export function NpmIcon() {
  return (
    <svg className="project-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
    </svg>
  );
}

/**
 * The source on GitHub and the package on npm, as icon links. Each name stays readable to
 * screen readers when a narrow layout shows only the icons (`.project-name` is the visible text).
 */
export function ProjectLinks({
  className,
  label,
}: {
  readonly className: string;
  readonly label?: string;
}) {
  return (
    <ul className={className} aria-label={label}>
      <li>
        <a href={GITHUB_URL}>
          <GitHubIcon />
          <span className="project-name">GitHub</span>
        </a>
      </li>
      <li>
        <a href={NPM_URL}>
          <NpmIcon />
          <span className="project-name">npm</span>
        </a>
      </li>
    </ul>
  );
}
