import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: 레포 이름이 quiz-submit일 때 base를 '/quiz-submit/'로
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/quiz-submit/' : '/',
}))
