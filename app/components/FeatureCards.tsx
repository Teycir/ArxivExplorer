// app/components/FeatureCards.tsx
'use client';

import Link from 'next/link';
import { AchievementsWidget } from './AchievementsWidget';

interface FeatureItem {
  icon: string;
  label: string;
  description: string;
  href: string;
  external?: boolean;
}

const FEATURES: FeatureItem[] = [
  {
    icon: '📝',
    label: 'Abstract Search',
    description: 'Paste any paper text to find semantically similar work instantly',
    href: '/search',
  },
  {
    icon: '⚖️',
    label: 'Compare',
    description: 'Side-by-side diff of two papers — methods, results, claims',
    href: '/compare',
  },
  {
    icon: '🌐',
    label: 'Explore',
    description: 'Browse the full indexed arXiv CS corpus',
    href: '/explore',
  },
  {
    icon: '👤',
    label: 'Authors',
    description: 'Researcher profiles, timelines and co-author graphs',
    href: '/author',
  },
  {
    icon: '★',
    label: 'Bookmarks',
    description: 'Save and organise papers for later reading',
    href: '/bookmarks',
  },
  {
    icon: '🔬',
    label: 'Claim Tracker',
    description: 'Type any claim — see which papers support or contradict it',
    href: '/claim',
  },
];

export function FeatureCards() {
  return (
    <section>
      {/* Section header */}
      <div className="flex flex-col items-center gap-2 mb-6">
        <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
          All Features
        </h2>
        <p className="text-[10px] font-mono text-neon-red/25 text-center max-w-xs leading-relaxed">
          Everything you need to explore, understand, and track CS research
        </p>
      </div>

      {/* Grid — feature link cards + achievements widget slot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">

        {/* Feature link cards */}
        {FEATURES.map((feature) => (
          <Link
            key={feature.label}
            href={feature.href}
            target={feature.external ? '_blank' : undefined}
            rel={feature.external ? 'noopener noreferrer' : undefined}
            className="group relative flex flex-col gap-2.5 p-3.5 rounded-xl
              border border-neon-red/10 bg-black/20
              hover:border-neon-red/35 hover:bg-neon-red/5
              transition-all duration-200 card-scanlines overflow-hidden"
          >
            <div className="flex items-start justify-between gap-1">
              <span className="text-xl leading-none select-none">{feature.icon}</span>
              {feature.external && (
                <span className="text-[11px] text-neon-red/20 group-hover:text-neon-red/50 transition-colors">↗</span>
              )}
            </div>
            <div className="flex-1">
              <p className="text-xs font-mono font-bold text-white/80 group-hover:text-white
                transition-colors leading-snug mb-0.5">
                {feature.label}
              </p>
              <p className="text-[10px] font-mono text-neon-red/35 group-hover:text-neon-red/55
                transition-colors leading-relaxed">
                {feature.description}
              </p>
            </div>
            <span className="absolute bottom-0 left-0 right-0 h-[1px]
              bg-gradient-to-r from-transparent via-neon-red/40 to-transparent
              scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-center" />
          </Link>
        ))}

        {/* Achievements widget — spans full width on the last row */}
        <div className="col-span-2 sm:col-span-3">
          <AchievementsWidget />
        </div>

      </div>
    </section>
  );
}
