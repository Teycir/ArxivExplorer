/**
 * ESM resolve hook for render tests. Replaces ONLY the modules that need a
 * mounted Next app router (next/link + router-hook client components) with inert
 * stubs. page.tsx, helper/api.ts and QuotaNotice are left real.
 *
 * Stubs are `data:` modules, which cannot resolve bare specifiers like 'react',
 * so they return plain React-element-shaped objects instead of importing
 * createElement.
 */
const STUB_MODULES = [
  /\/app\/components\/SearchBoxHome(\.tsx)?$/,
  /\/app\/components\/RecentSearches(\.tsx)?$/,
  /\/app\/components\/PersonalizedFeed(\.tsx)?$/,
  /\/app\/components\/AnimatedTagline(\.tsx)?$/,
  /\/app\/components\/ui\/background-beams(\.tsx)?$/,
  /\/app\/components\/RssAbstractFeed(\.tsx)?$/,
  /\/app\/components\/FeatureCards(\.tsx)?$/,
  /\/app\/components\/Navbar(\.tsx)?$/,
  /\/app\/components\/PaperCard(\.tsx)?$/,
  /\/app\/components\/TopicActivityTracker(\.tsx)?$/,
  /\/app\/components\/AchievementToast(\.tsx)?$/,
  /\/app\/explore\/ExploreClient(\.tsx)?$/,
];

// React 18 element shape (react.element; React 19 uses react.transitional.element).
const el = (type, props) =>
  `({ $$typeof: Symbol.for('react.element'), type: ${type}, key: null, ref: null, props: ${props}, _owner: null, _store: {} })`;

export async function resolve(specifier, context, next) {
  if (specifier === 'next/link') {
    const src =
      `export default function Link(p){ const {href, children, ...rest} = p;
         return ({ $$typeof: Symbol.for('react.element'), type: 'a', key: null, ref: null,
                   props: { href, ...rest, children }, _owner: null, _store: {} }); }`;
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  if (specifier === 'next/navigation') {
    const src = `export function notFound(){ const e = new Error('NEXT_NOT_FOUND'); e.digest='NEXT_NOT_FOUND'; throw e; }
                 export const useRouter = () => ({}); export const useSearchParams = () => new URLSearchParams();
                 export const usePathname = () => '/';`;
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  const resolved = await next(specifier, context);
  if (STUB_MODULES.some(re => re.test(resolved.url))) {
    const name = resolved.url.split('/').pop().replace(/\.tsx?$/, '');
    // Deduped export list: the file's own name plus every named export the pages import.
    const names = [...new Set([name.replace(/[^A-Za-z0-9]/g, ''), 'BackgroundBeams', 'Navbar', 'PaperCard',
                               'TopicActivityTracker', 'AchievementToast', 'ExploreClient'])];
    const src =
      `const S = () => ${el("'div'", `{ 'data-stub': '${name}' }`)};
       export default S;
       ${names.map(n => `export const ${n} = S;`).join('\n       ')}`;
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  return resolved;
}
