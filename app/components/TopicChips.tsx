// app/components/TopicChips.tsx
import Link from 'next/link';

interface TopicChip {
  slug: string;
  label: string;
}

export function TopicChips({ topics }: { topics: TopicChip[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {topics.map((t) => (
        <Link
          key={t.slug}
          href={`/topic/${t.slug}`}
          className="px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider
            border border-neon-red/20 text-neon-red/60 rounded-lg
            hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5
            transition-all duration-200"
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
