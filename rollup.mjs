import {terser} from 'rollup-plugin-terser';
import strip from '@rollup/plugin-strip';
import bundleSize from 'rollup-plugin-bundle-size';
import progress from 'rollup-plugin-progress';
import ignore from "rollup-plugin-ignore";
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import alias from '@rollup/plugin-alias';
import {babel} from '@rollup/plugin-babel';

const GAME = process.env.GAME ?? "";

export default {
  input: "-",
  plugins: [
    progress({}),
    resolve({
      browser: true,
    }),
    commonjs({
      transformMixedEsModules: true,
    //   include: 'node_modules/**',
    }),
    babel({
      exclude: /node_modules/,
      babelHelpers: 'bundled'
    }),
    terser({
      compress: {
        passes: 3,
        unsafe: true,
      },
      module: true,
      toplevel: true
    }),
    strip({}),
    bundleSize(),
  ],
  preserveEntrySignatures: true,
  output: {
    inlineDynamicImports: true,
    format: 'esm',
    name: 'main',
    sourcemap: false,
    file: `www/${GAME}/bundle.js`
  }
};