import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const jsonResponse = (res, statusCode, payload) => {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const readRequestBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const resolveFunctionsBase = (env) => {
  const getEnv = (name) => env[name] || process.env[name] || ''
  const explicitBase = getEnv('VITE_FUNCTIONS_BASE_URL')
    || getEnv('VITE_FUNCTIONS_BASE')
    || getEnv('VITE_MODERATION_API_BASE')

  if (explicitBase) return explicitBase

  return getEnv('VITE_MODERATION_FUNCTION_URL').replace(/\/moderateImage\/?$/, '')
}

const codexDevLoginProxyPlugin = ({ functionsBase, secret }) => ({
  name: 'codex-dev-login-proxy',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__codex-dev-login', async (req, res) => {
      if (req.method !== 'POST') {
        jsonResponse(res, 405, { error: 'Method not allowed' })
        return
      }

      if (!functionsBase || !secret) {
        jsonResponse(res, 503, {
          error: 'Codex dev login proxy is not configured. Set CODEX_DEV_LOGIN_SECRET and a supported Functions endpoint variable for the Vite dev server.',
          code: 'codex_dev_proxy_not_configured',
        })
        return
      }

      try {
        const body = await readRequestBody(req)
        const upstream = await fetch(`${functionsBase.replace(/\/$/, '')}/createDevCodexToken`, {
          method: 'POST',
          headers: {
            'Content-Type': req.headers['content-type'] || 'application/json',
            'X-Codex-Dev-Secret': secret,
          },
          body: body.length ? body : Buffer.from('{}'),
        })
        const text = await upstream.text()
        res.statusCode = upstream.status
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
        res.end(text)
      } catch (error) {
        jsonResponse(res, 502, {
          error: 'Codex dev login proxy request failed.',
          code: 'codex_dev_proxy_failed',
        })
      }
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      codexDevLoginProxyPlugin({
        functionsBase: resolveFunctionsBase(env),
        secret: env.CODEX_DEV_LOGIN_SECRET || process.env.CODEX_DEV_LOGIN_SECRET || '',
      }),
    ],
    server: {
      proxy: {
        '/api': 'http://localhost:5000',
      },
    },
    preview: {
      proxy: {
        '/api': 'http://localhost:5000',
      },
    },
  }
})
