// ============================================================
// Dunham+Co Software Tracker — MCP Server
// Cloudflare Pages Function at /api/mcp
// Compatible with Claude.ai MCP (Model Context Protocol)
// ============================================================

const STORAGE_KEY = 'dc_techstack_v1';
const AUTH_TOKEN  = 'dunham-mcp-2026'; // change this to something secret

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

// ── Tool definitions (what Claude sees) ─────────────────────
const TOOLS = [
  {
    name: 'list_tools',
    description: 'List all software tools in the Dunham+Co tracker. Can filter by status or department.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'under review', 'cancelled', 'all'], description: 'Filter by status' },
        department: { type: 'string', description: 'Filter by department name' },
      },
    },
  },
  {
    name: 'get_renewals',
    description: 'Get tools renewing within a given number of days. Great for renewal planning.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look ahead (default 90)' },
      },
    },
  },
  {
    name: 'get_summary',
    description: 'Get financial summary: total Amortize (annual), INCOR (monthly), tool counts by status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_tool',
    description: 'Add a new software tool to the tracker.',
    inputSchema: {
      type: 'object',
      required: ['name', 'department'],
      properties: {
        name:       { type: 'string',  description: 'Tool name' },
        department: { type: 'string',  description: 'Department (e.g. Marketing, Operations, Data)' },
        annual_cost:{ type: 'number',  description: 'Total annual cost in dollars' },
        monthly_cost:{ type: 'number', description: 'Monthly subscription cost' },
        status:     { type: 'string',  enum: ['active', 'under review'], description: 'Tool status (default: active)' },
        renewal_date:{ type: 'string', description: 'Renewal date in YYYY-MM-DD format' },
        start_date: { type: 'string',  description: 'Start date in YYYY-MM-DD format' },
        billing_terms:{ type: 'string',description: 'e.g. Monthly, Annual' },
        admin:      { type: 'string',  description: 'Admin or owner name' },
        notes:      { type: 'string',  description: 'Any notes' },
        definition: { type: 'string',  description: 'What the tool does' },
      },
    },
  },
  {
    name: 'update_tool',
    description: 'Update fields on an existing tool. Find by name.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name:        { type: 'string', description: 'Current tool name to find' },
        new_name:    { type: 'string', description: 'New name if renaming' },
        department:  { type: 'string' },
        annual_cost: { type: 'number' },
        monthly_cost:{ type: 'number' },
        status:      { type: 'string', enum: ['active', 'under review', 'cancelled'] },
        renewal_date:{ type: 'string' },
        billing_terms:{ type: 'string' },
        admin:       { type: 'string' },
        notes:       { type: 'string' },
        definition:  { type: 'string' },
      },
    },
  },
  {
    name: 'cancel_tool',
    description: 'Mark a tool as cancelled. Records the cancellation date automatically.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Tool name to cancel' },
        notes: { type: 'string', description: 'Optional reason for cancellation' },
      },
    },
  },
  {
    name: 'search_tools',
    description: 'Search tools by name, department, or notes keyword.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
    },
  },
];

// ── Tool handlers ────────────────────────────────────────────
async function handleTool(name, args, KV) {
  const raw = await KV.get(STORAGE_KEY);
  let tools = raw ? JSON.parse(raw) : [];

  const today = new Date().toISOString().split('T')[0];
  const fmt = n => '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // ── list_tools ──
  if (name === 'list_tools') {
    let result = tools;
    if (args.status && args.status !== 'all') result = result.filter(t => t.st === args.status);
    if (args.department) result = result.filter(t => (t.dept || '').toLowerCase().includes(args.department.toLowerCase()));
    return {
      count: result.length,
      tools: result.map(t => ({
        name: t.name, department: t.dept, status: t.st,
        annual_cost: fmt(t.ta), renewal_date: t.rd || '—', admin: t.adm || '—',
      })),
    };
  }

  // ── get_renewals ──
  if (name === 'get_renewals') {
    const days = args.days || 90;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
    const active = tools.filter(t => t.st === 'active' && t.rd);
    const upcoming = active
      .map(t => ({ ...t, _days: Math.round((new Date(t.rd) - new Date()) / 86400000) }))
      .filter(t => t._days <= days)
      .sort((a, b) => a._days - b._days);
    return {
      window_days: days,
      count: upcoming.length,
      total_at_risk: fmt(upcoming.reduce((s, t) => s + (+t.ta || 0), 0)),
      renewals: upcoming.map(t => ({
        name: t.name, department: t.dept,
        renewal_date: t.rd, days_until: t._days,
        annual_cost: fmt(t.ta), status: t.st,
      })),
    };
  }

  // ── get_summary ──
  if (name === 'get_summary') {
    const active   = tools.filter(t => t.st === 'active');
    const review   = tools.filter(t => t.st === 'under review');
    const cancelled= tools.filter(t => t.st === 'cancelled');
    const amortize = active.reduce((s, t) => s + (+t.ta || 0), 0);
    return {
      amortize_annual: fmt(amortize),
      incor_monthly: fmt(amortize / 12),
      active_tools: active.length,
      under_review: review.length,
      cancelled_tools: cancelled.length,
      total_tools: tools.length,
      review_savings_potential: fmt(review.reduce((s, t) => s + (+t.ta || 0), 0)),
    };
  }

  // ── add_tool ──
  if (name === 'add_tool') {
    const exists = tools.find(t => t.name.toLowerCase() === args.name.toLowerCase());
    if (exists) return { error: `Tool "${args.name}" already exists. Use update_tool to modify it.` };
    const newTool = {
      name: args.name, dept: args.department,
      st: args.status || 'active',
      ta: args.annual_cost || 0,
      ms: args.monthly_cost || 0,
      as: args.annual_cost || 0,
      rd: args.renewal_date || '',
      sd: args.start_date || today,
      bt: args.billing_terms || '',
      adm: args.admin || '',
      notes: args.notes || '',
      def: args.definition || '',
      ct: '', cant: '', lic: '', ie: '', tu: '', int: '', sn: '', box: '', ai: '',
    };
    tools.push(newTool);
    await KV.put(STORAGE_KEY, JSON.stringify(tools));
    return { success: true, message: `✅ Added "${args.name}" to the tracker.`, tool: { name: newTool.name, department: newTool.dept, annual_cost: fmt(newTool.ta), status: newTool.st } };
  }

  // ── update_tool ──
  if (name === 'update_tool') {
    const idx = tools.findIndex(t => t.name.toLowerCase() === args.name.toLowerCase());
    if (idx === -1) return { error: `Tool "${args.name}" not found. Use list_tools to see all tools.` };
    const t = tools[idx];
    if (args.new_name)     t.name = args.new_name;
    if (args.department)   t.dept = args.department;
    if (args.annual_cost !== undefined) { t.ta = args.annual_cost; t.as = args.annual_cost; }
    if (args.monthly_cost !== undefined) t.ms = args.monthly_cost;
    if (args.status)       t.st = args.status;
    if (args.renewal_date) t.rd = args.renewal_date;
    if (args.billing_terms)t.bt = args.billing_terms;
    if (args.admin)        t.adm = args.admin;
    if (args.notes)        t.notes = args.notes;
    if (args.definition)   t.def = args.definition;
    tools[idx] = t;
    await KV.put(STORAGE_KEY, JSON.stringify(tools));
    return { success: true, message: `✅ Updated "${args.name}" successfully.` };
  }

  // ── cancel_tool ──
  if (name === 'cancel_tool') {
    const idx = tools.findIndex(t => t.name.toLowerCase() === args.name.toLowerCase());
    if (idx === -1) return { error: `Tool "${args.name}" not found.` };
    tools[idx].st = 'cancelled';
    tools[idx].cd = today;
    if (args.notes) tools[idx].notes = args.notes;
    await KV.put(STORAGE_KEY, JSON.stringify(tools));
    return { success: true, message: `✅ "${args.name}" marked as cancelled. Annual savings: ${fmt(tools[idx].ta)}` };
  }

  // ── search_tools ──
  if (name === 'search_tools') {
    const q = args.query.toLowerCase();
    const results = tools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.dept || '').toLowerCase().includes(q) ||
      (t.notes || '').toLowerCase().includes(q) ||
      (t.def || '').toLowerCase().includes(q)
    );
    return {
      query: args.query, count: results.length,
      tools: results.map(t => ({ name: t.name, department: t.dept, status: t.st, annual_cost: fmt(t.ta) })),
    };
  }

  return { error: `Unknown tool: ${name}` };
}

// ── Main request handler ─────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const KV = env.TECH_STACK;
  if (!KV) return json({ error: 'KV not bound' }, 500);

  const url = new URL(request.url);

  // ── GET /api/mcp — MCP discovery endpoint ──
  if (request.method === 'GET') {
    return json({
      name: 'dunham-software-tracker',
      version: '1.0.0',
      description: 'Manage the Dunham+Co software tool inventory',
      tools: TOOLS,
    });
  }

  // ── POST /api/mcp — execute a tool call ──
  if (request.method === 'POST') {
    // Auth check
    const auth = request.headers.get('Authorization') || '';
    if (!auth.includes(AUTH_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const { tool, arguments: args = {} } = body;
    if (!tool) return json({ error: 'Missing tool name' }, 400);

    try {
      const result = await handleTool(tool, args, KV);
      return json({ result });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
