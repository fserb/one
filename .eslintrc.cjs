"use strict";

module.exports = {
  extends: "eslint:recommended",
  root: true,
  rules: {
    "array-bracket-spacing": [ "error", "never" ],
    "arrow-parens": ["error", "as-needed"],
    "camelcase": ["error"],
    // "complexity": ["warn", 20],
    "comma-spacing": [ "error" ],
    "comma-style": [ "error" ],
    "curly": [ "error", "multi-line"],
    "guard-for-in": [ "error"],
    "indent": ["error", 2],
    'func-call-spacing': 'error',
    "linebreak-style": ["error", "unix"],
    "max-len": [ "error", { "code": 80, "tabWidth": 2 } ],
    "no-multiple-empty-lines": [ "error", {max: 1} ],
    "no-tabs": [ "error" ],
    "keyword-spacing": "error",
    "key-spacing": ["error", {"beforeColon": false, "afterColon": true}],
    "no-with": ["error"],
    "new-cap": ["error", {"capIsNew": false}],
    'no-array-constructor': 'error',
    "no-caller": ["error"],
    "no-multi-spaces": ["error", { ignoreEOLComments: true }],
    "no-multi-str": ["error"],
    "no-invalid-this": ["error"],
    "no-trailing-spaces": [ "error" ],
    "no-new-wrappers": ["error"],
    "no-new-symbol": ["error"],
    "no-irregular-whitespace": ["error"],
    "no-unneeded-ternary": [ "error", { "defaultAssignment": false } ],
    "no-unused-vars": ["error", {"argsIgnorePattern": "^_", "varsIgnorePattern": "^_"}],
    "no-unused-expressions": ["error"],
    "prefer-promise-reject-errors": ["error"],
    "prefer-spread": ["error"],
    "rest-spread-spacing": ["error"],
    "prefer-rest-params": ["error"],
    "no-unexpected-multiline": ["error"],
    "no-unsafe-optional-chaining": "error",
    "no-use-before-define": [ "error" ],
    "no-constant-condition": [ "error", { "checkLoops": false } ],
    "no-constructor-return": ["error"],
    "no-implied-eval": ["error"],
    "no-throw-literal": ["error"],
    "no-var": [ "error" ],
    "no-shadow": ["error"],
    "padded-blocks": [ "error", "never" ],
    "prefer-const": [ "error", { "destructuring": "all"}],
    "semi": ["error", "always"],
    "semi-spacing": ["error"],
    "require-await": ["error"],
    "space-before-blocks": [ "error", "always"],
    "space-before-function-paren": ["error", {
      "anonymous": "never",
      "named": "never",
      "asyncArrow" : "always"
    }],
    "space-in-parens": [ "error", "never"],
    "space-infix-ops": [ "error", {"int32Hint": true}],
  },
  ignorePatterns: ["src/one/lib/planck.js", "src/one/lib/fsfx"],
  env: {
    browser: true,
    es6: true
  },

  globals: {
  },

  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  }
};
