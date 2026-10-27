// Bundle de produção da API e do worker: um arquivo por entrypoint, com as dependências dentro
// (inclusive o @vesso-fin/shared, que é .ts). Assim a Railway roda `node dist/…` sem tsx nem devDependencies.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/server.ts', 'src/worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  external: ['pg-native'],   // opcional do pg; não usamos
  // pg é CommonJS e usa require(): no bundle ESM, require precisa existir
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: 'info',
})
