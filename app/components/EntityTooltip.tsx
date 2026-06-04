'use client';

import { useState } from 'react';

interface Props {
  entity: string;
  children: React.ReactNode;
}

interface EntityDefinitionsResponse {
  definitions?: Record<string, string>;
}

export function EntityTooltip({ entity, children }: Props) {
  const [def, setDef] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const load = async () => {
    if (def !== null) return;
    try {
      const res = await fetch(`/api/entity-definitions?names=${encodeURIComponent(entity)}`);
      const data: EntityDefinitionsResponse = await res.json();
      setDef(data.definitions?.[entity] || 'No definition available');
    } catch {
      setDef('Failed to load');
    }
  };

  return (
    <span 
      className="relative inline-block group"
      onMouseEnter={() => { setShow(true); load(); }}
      onMouseLeave={() => setShow(false)}
    >
      <span className="underline decoration-dotted decoration-neon-red/30 cursor-help">
        {children}
      </span>
      {show && def && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black border border-neon-red/40 rounded text-xs font-mono text-white/90 w-64 z-50 shadow-lg">
          {def}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] w-2 h-2 rotate-45 bg-black border-r border-b border-neon-red/40" />
        </span>
      )}
    </span>
  );
}
