// app/components/TopicChips.tsx
import Link from 'next/link';

interface TopicChip {
  slug: string;
  label: string;
  category?: string; // optional category badge
}

export function TopicChips({ topics }: { topics: TopicChip[] }) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {topics.map((t) => (
        <Link
          key={t.slug}
          href={`/topic/${t.slug}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold
            uppercase tracking-wider border border-neon-red/20 text-neon-red/60 rounded-lg
            hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5
            transition-all duration-200"
        >
          {t.label}
          {t.category && (
            <span className="text-[9px] font-normal normal-case tracking-normal
              text-neon-red/30 border border-neon-red/15 rounded px-1 py-0.5 hidden sm:inline">
              {t.category}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
