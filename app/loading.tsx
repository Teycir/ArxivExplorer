// app/loading.tsx — global loading skeleton (shown during RSC transitions)
import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center py-32">
      <Loader2 size={28} className="text-neon-red/40 animate-spin" />
    </div>
  );
}
