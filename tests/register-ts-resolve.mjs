// Lets `node --test` load app modules that use extensionless relative imports
// (Vite/TS bundler style), e.g. `import { x } from '../utils'` → ../utils.ts.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return await next(specifier + '.ts', context); } catch {}
  }
  return next(specifier, context);
}
`),
  import.meta.url
);
