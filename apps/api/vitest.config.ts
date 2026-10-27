import { defineConfig } from 'vitest/config'

// Os testes de integração dividem um banco (scripts/test-api.sh): um arquivo por vez, em ordem.
export default defineConfig({ test: { fileParallelism: false } })
