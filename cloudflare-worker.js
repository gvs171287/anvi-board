// Cloudflare Worker: proxies requests to Anthropic, keeping your API key secret.
//
// Setup:
// 1. Go to dash.cloudflare.com -> Workers & Pages -> Create Worker
// 2. Paste this code in, replacing the default
// 3. Go to Settings -> Variables -> add a secret named ANTHROPIC_API_KEY with your key
// 4. Deploy, and copy the Worker's URL (looks like https://your-worker-name.your-subdomain.workers.dev)
// 5. Set that URL as VITE_API_PROXY_URL in your site's environment variables

const ALLOWED_ORIGIN = "*"; // tighten this to your actual site URL once deployed, e.g. "https://yourusername.github.io"

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.text();

      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });

      const responseBody = await anthropicResponse.text();

      return new Response(responseBody, {
        status: anthropicResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
      });
    }
  },
};
