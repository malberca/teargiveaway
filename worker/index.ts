interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', service: 'tear-sorteos' })
    }

    return env.ASSETS.fetch(request)
  },
}
