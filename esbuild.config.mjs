import esbuild from 'esbuild';

const production = process.argv.includes('production');
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  minify: production,
  outfile: 'main.js',
});
