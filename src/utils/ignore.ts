import { createRequire } from 'node:module';
import type { Ignore, Options } from 'ignore';

// `ignore` is CommonJS whose declaration advertises an ESM default export.
// Under NodeNext, `import ignore from 'ignore'` therefore types as the module
// namespace instead of the callable factory. Load it through createRequire so
// the emitted ESM and the type surface agree.
const require = createRequire(import.meta.url);
const ignore = require('ignore') as (options?: Options) => Ignore;

export default ignore;
