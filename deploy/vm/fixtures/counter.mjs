export class Counter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const value = await this.state.storage.get("count") ?? 0;
    if (request.method === "POST") {
      await this.state.storage.put("count", value + 1);
      return new Response(`counter=${value + 1}`);
    }
    return new Response(`counter=${value}`);
  }
}

export default {
  async fetch(request, env) {
    const id = env.COUNTER.idFromName("fixture");
    return env.COUNTER.get(id).fetch("http://counter/", {
      method: request.method,
    });
  },
};
