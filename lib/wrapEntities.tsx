import { EntityTooltip } from '@/app/components/EntityTooltip';

export function wrapEntities(text: string, entities: string[]): React.ReactNode {
  if (!entities || entities.length === 0) return text;

  // Sort entities by length (longest first) to avoid partial matches
  const sorted = [...entities].sort((a, b) => b.length - a.length);
  
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let matched = false;

    for (const entity of sorted) {
      const idx = remaining.toLowerCase().indexOf(entity.toLowerCase());
      if (idx === 0) {
        const actual = remaining.slice(0, entity.length);
        parts.push(
          <EntityTooltip key={key++} entity={entity}>
            {actual}
          </EntityTooltip>
        );
        remaining = remaining.slice(entity.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts;
}
