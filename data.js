// Cloudflare Pages Function — handles /api/data
// Reads and writes tool data to Cloudflare KV (TECH_STACK namespace)
//
// GET  /api/data?key=dc_techstack_v1  → returns { value: [...tools] }
// POST /api/data                       → body { key, value } → saves to KV

export async function onRequest(context) {
  const { request, env } = context;

  // CORS headers — allows your HTML page to call this API
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // KV namespace is bound as TECH_STACK in wrangler.toml
  const KV = env.TECH_STACK;

  if (!KV) {
    return new Response(
      JSON.stringify({ error: 'KV namespace not bound. Check wrangler.toml.' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // ── GET — load data ──────────────────────────────────────────
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') || 'dc_techstack_v1';

    const raw = await KV.get(key);

    if (!raw) {
      // No data saved yet — return empty so frontend uses defaults
      return new Response(
        JSON.stringify({ value: null }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({ value: JSON.parse(raw) }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // ── POST — save data ─────────────────────────────────────────
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const { key = 'dc_techstack_v1', value } = body;

    if (!value) {
      return new Response(
        JSON.stringify({ error: 'Missing value' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    await KV.put(key, JSON.stringify(value));

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders });
}
