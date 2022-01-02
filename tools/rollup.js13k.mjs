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
      presets: [[
        "@babel/preset-env",
        {
          "targets": "last 1 chrome version, last 1 firefox version",
          "useBuiltIns": "usage",
          "corejs": "3.16",
          "modules": false,
        }
      ]],
    }),
    strip({
    }),
    terser({
      ecma: 2020,
      compress: {
        booleans_as_integers: true,
        keep_fargs: false,
        toplevel: true,
        module: true,
        ecma: 2020,
        passes: 5,
        unsafe: true,
        unsafe_comps: true,
        unsafe_Function: true,
        unsafe_math: true,
        unsafe_methods: true,
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
        ecma: 2020,
        indent_level: 0,

      },
      module: true,
      toplevel: true,
      keep_classnames: false,
      keep_fnames: false,
    }),
    bundleSize(),
  ],
  preserveEntrySignatures: true,
  treeshake: "smallest",
  output: {
    inlineDynamicImports: true,
    format: 'esm',
    name: 'main',
    sourcemap: false,
  }
};
