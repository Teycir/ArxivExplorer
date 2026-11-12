import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

// Minimal stand-ins for the contexts Next mounts at runtime. These tests call
// the page component directly, so without them `useRouter()` throws
// "expected app router to be mounted" — and on Node 22 (CI) an ESM stub loader
// cannot intercept the CJS requires tsx emits inside app/page.tsx.
const router = {
  push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {},
};

export function renderWithRouter(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        PathnameContext.Provider,
        { value: '/' },
        createElement(
          SearchParamsContext.Provider,
          { value: new URLSearchParams() as never },
          element,
        ),
      ),
    ),
  );
}
