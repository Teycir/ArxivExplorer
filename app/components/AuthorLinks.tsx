/**
 * app/components/AuthorLinks.tsx
 *
 * 'use client' wrapper so that author <Link> elements can use stopPropagation
 * without violating the Server Component rule against onClick props.
 *
 * Used by PaperCard (inside an outer <Link>) and PaperPage (no outer link).
 */
'use client';

import Link from 'next/link';

interface AuthorLinksProps {
  authors: string[];
  max?: number;
}

export function AuthorLinks({ authors, max = 4 }: AuthorLinksProps) {
  const visible = authors.slice(0, max);
  const overflow = authors.length - max;

  return (
    <>
      {visible.map((author, i) => (
        <span key={`${author}-${i}`}>
          <Link
            href={`/author/${encodeURIComponent(author)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-neon-red hover:underline decoration-neon-red/30 transition-colors"
          >
            {author}
          </Link>
          {i < visible.length - 1 && (
            <span className="text-neon-red/25">, </span>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-neon-red/25"> +{overflow} more</span>
      )}
    </>
  );
}
