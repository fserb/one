import {terser} from 'rollup-plugin-terser';
import strip from '@rollup/plugin-strip';
import bundleSize from 'rollup-plugin-bundle-size';
import progress from 'rollup-plugin-progress';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import {babel} from '@rollup/plugin-babel';

export default {
  input: "-",
  plugins: [
    progress({}),
    resolve({
      browser: true,
    }),
    commonjs({
      transformMixedEsModules: true,
    }),
    babel({
      exclude: /node_modules/,
      babelHelpers: 'bundled',
      // compact: true,
      compact: true,
      minified: true,
      presets: [[
        "@babel/preset-env",
        {
          "targets": "last 1 chrome version, last 1 android version",
          "useBuiltIns": "usage",
          "corejs": "3.16",
          "modules": false,
        }
      ]],
    }),
    terser({
      ecma: 2016,
      compress: {
        toplevel: true,
        module: true,
        ecma: 2016,
        passes: 5,
        unsafe: true,
        unsafe_comps: true,
        unsafe_Function: true,
        unsafe_math: true,
        unsafe_proto: true,
        unsafe_regexp: true,
        unsafe_undefined: true,
      },
      mangle: {
        toplevel: true,
        module: true,
        eval: true,
      },
      format: {
        comments: false,
        ecma: 2016,
      },
      module: true,
      toplevel: true,
      keep_classnames: false,
      keep_fnames: false,
    }),
    strip({

    }),
    bundleSize(),
  ],
  preserveEntrySignatures: true,
  output: {
    inlineDynamicImports: true,
    format: 'esm',
    name: 'main',
    sourcemap: false,
  }
};
