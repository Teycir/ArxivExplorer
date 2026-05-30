// app/not-found.tsx
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center gap-6">
      <AlertCircle size={48} className="text-neon-red/25" />
      <div>
        <p className="text-xs font-mono text-neon-red/40 uppercase tracking-widest mb-2">404</p>
        <h1 className="text-2xl font-mono font-bold text-white/80 mb-3">Page not found</h1>
        <p className="text-sm text-white/35 font-mono max-w-sm mx-auto">
          The page or paper you were looking for doesn&apos;t exist or hasn&apos;t been indexed yet.
        </p>
      </div>
      <Link
        href="/"
        className="px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider
          border border-neon-red/30 text-neon-red/70 rounded-lg
          hover:border-neon-red/60 hover:text-neon-red hover:bg-neon-red/5 transition-all"
      >
        ← Back to home
      </Link>
    </main>
  );
}
