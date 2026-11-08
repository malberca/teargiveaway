import { handleInstagramRequest } from './instagram'

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  INSTAGRAM_CONFIG_ID?: string
  INSTAGRAM_APP_ID?: string
  INSTAGRAM_APP_SECRET?: string
  INSTAGRAM_REDIRECT_URI?: string
  INSTAGRAM_SESSION_KEY?: string
  INSTAGRAM_GRAPH_VERSION?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', service: 'tear-sorteos' })
    }

    if (url.pathname.startsWith('/api/instagram/')) {
      return handleInstagramRequest(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
