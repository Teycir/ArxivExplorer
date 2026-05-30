// app/components/CategoryBadge.tsx
import { categoryColorClass } from '@/helper/format';

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`badge ${categoryColorClass(category)}`}>
      {category}
    </span>
  );
}
