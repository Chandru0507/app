
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Build targets — each embeds a different API base URL into the bundle:
//   npm run build          -> web      (.env         -> http://localhost:5000)
//   npm run build:android  -> emulator (.env.android -> http://10.0.2.2:5000)
//   npm run build:device   -> real phone (.env.device -> http://<lan-ip>:5000)
// `VITE_MODE=<target>` is equivalent to `--mode <target>`; the android branch
// is unchanged so the existing emulator build keeps working as before.
export default defineConfig(({ mode }) => {
  const selected = process.env.VITE_MODE || mode
  const env = loadEnv(mode, process.cwd(), '')
  const androidEnv = loadEnv('android', process.cwd(), '')
  const deviceEnv = loadEnv('device', process.cwd(), '')

  let apiUrl
  if (selected === 'android') {
    apiUrl = androidEnv.VITE_API_URL
  } else if (selected === 'device') {
    apiUrl = deviceEnv.VITE_API_URL
  } else {
    apiUrl = env.VITE_API_URL
  }

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(
        apiUrl || 'http://localhost:5000'
      ),
    },
  }
})
