export interface Env {
  TEST_DO: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response('Hello World!')
  },
}
