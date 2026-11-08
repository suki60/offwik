// The Cloudflare Worker behind offwik.com. Cloudflare serves the files in
// dist/ itself and calls this only for requests that match none of them:
// /data/*, kept out of the upload by public/.assetsignore (text.bin and
// vectors.i8 are over the 25 MiB per-file limit). Those files live in the R2
// bucket offwik-data under the same path ("data/text.bin"), see
// wrangler.jsonc.

// Only the part of R2's binding this file uses.
type Env = {
  DATA: { get(key: string): Promise<{ body: ReadableStream } | null> };
};

export default {
  async fetch(request: Request, env: Env) {
    const key = new URL(request.url).pathname.slice(1);
    const object = await env.DATA.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body);
  },
};
