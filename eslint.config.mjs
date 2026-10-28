export default [{
    files: ['extension/**/*.js', 'tests/**/*.js', 'companion/**/*.js'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
            global: 'readonly',
            console: 'readonly',
            ARGV: 'readonly',
            imports: 'readonly',
            print: 'readonly',
            printerr: 'readonly',
        },
    },
    rules: {
        'no-undef': 'error',
        'no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
        'no-unreachable': 'error',
        'no-duplicate-imports': 'error',
        'no-constant-condition': 'error',
        eqeqeq: ['error', 'always'],
    },
}];
