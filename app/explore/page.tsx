'use client';

import { Suspense } from 'react';
import { Navbar } from '../components/Navbar';
import { PaperCloudVis } from '../components/PaperCloudVis';
import { Loader2 } from 'lucide-react';

export default function ExplorePage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 relative">
        <Suspense fallback={
          <div className="flex items-center justify-center h-screen">
            <Loader2 size={32} className="text-neon-red/50 animate-spin" />
          </div>
        }>
          <PaperCloudVis />
        </Suspense>
      </main>
    </>
  );
}
