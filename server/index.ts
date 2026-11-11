export class Room { constructor(public ctx: DurableObjectState, public env: unknown) {} async fetch(_r: Request): Promise<Response> { return new Response('ok'); } }
export default { async fetch(_r: Request): Promise<Response> { return new Response('hi'); } };
