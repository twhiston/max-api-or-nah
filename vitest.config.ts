import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8', // or 'istanbul'
            reporter: ['text', 'json-summary', 'json', 'html'],
            reportOnFailure: true,
            //@ts-ignore
            exclude: [...configDefaults.coverage.exclude, "src/**"]
        },
    },
})