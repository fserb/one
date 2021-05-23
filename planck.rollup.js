// import bundleSize from 'rollup-plugin-bundle-size';
import progress from 'rollup-plugin-progress';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
// import ignore from "rollup-plugin-ignore";

export default {
  input: "node_modules/planck/dist/planck.js",
  plugins: [
    progress({}),
    resolve({
      browser: true,
    }),
    commonjs({
      // ignoreGlobal: true,
    //   esmExternals: true,
    //   transformMixedEsModules: true,
  // //   include: 'node_modules/**',
    }),
    // babel({
    //   exclude: /node_modules/,
    //   babelHelpers: 'bundled'
    // }),
  ],
  preserveEntrySignatures: true,
  // preserveModules: true,
  output: {
    // inlineDynamicImports: true,
    format: 'esm',
    name: 'planck',
    sourcemap: false,
    file: 'src/one/lib/planck.js',
    // dir: 'src/one/lib/plank/',
  }
};