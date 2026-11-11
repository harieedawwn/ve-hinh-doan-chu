export class Room { constructor(ctx: DurableObjectState, env: unknown) { void ctx; void env; } async fetch(_r: Request): Promise<Response> { return new Response('ok'); } }
export default { async fetch(_r: Request): Promise<Response> { return new Response('hi'); } };
