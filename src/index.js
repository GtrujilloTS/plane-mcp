#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Configuración desde variables de entorno ---
const API_KEY      = process.env.PLANE_API_KEY;
const BASE_URL     = (process.env.PLANE_URL || "").replace(/\/$/, "");
const WORKSPACE    = process.env.PLANE_WORKSPACE;
const PROJECT_ID   = process.env.PLANE_PROJECT_ID;
const PROJECT_NAME = process.env.PLANE_PROJECT_NAME || "Proyecto";

function checkConfig() {
  const missing = [];
  if (!API_KEY)    missing.push("PLANE_API_KEY");
  if (!BASE_URL)   missing.push("PLANE_URL");
  if (!WORKSPACE)  missing.push("PLANE_WORKSPACE");
  if (!PROJECT_ID) missing.push("PLANE_PROJECT_ID");
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
  }
}

// --- Cliente Plane API ---
async function planeGet(path) {
  const url = `${BASE_URL}/api/v1/workspaces/${WORKSPACE}${path}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Plane API ${res.status}: ${url}`);
  return res.json();
}

async function getAllIssues() {
  let page = 1, all = [], hasMore = true;
  while (hasMore) {
    const data = await planeGet(`/projects/${PROJECT_ID}/issues/?per_page=100&page=${page}`);
    all = all.concat(data.results || []);
    hasMore = data.next_page_results;
    page++;
  }
  return all;
}

async function getStates() {
  const data = await planeGet(`/projects/${PROJECT_ID}/states/`);
  return data.results || [];
}

async function getMembers() {
  const data = await planeGet(`/members/`);
  const results = Array.isArray(data) ? data : (data.results || []);
  const map = {};
  for (const m of results) {
    const member = m.member || m;
    if (member.id) map[member.id] = member.display_name || member.email || member.id;
  }
  return map;
}

// --- Helpers de formato ---
const PRIORITY_LABEL = {
  urgent: "🔴 Urgente",
  high:   "🟠 Alta",
  medium: "🟡 Media",
  low:    "🔵 Baja",
  none:   "⚪ Sin definir",
};

function priorityOrder(p) {
  return { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }[p] ?? 5;
}

function today() {
  return new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
}

// --- Lógica de reportes ---

function buildContext(issues, states, members) {
  const stateMap = {};
  const closedIds = new Set();
  for (const s of states) {
    stateMap[s.id] = s.name;
    if (s.group === "completed" || s.group === "cancelled") closedIds.add(s.id);
  }

  const open   = issues.filter(i => !closedIds.has(i.state));
  const closed = issues.filter(i =>  closedIds.has(i.state));

  function enrich(i) {
    return {
      ...i,
      stateName: stateMap[i.state] || i.state,
      priorityLabel: PRIORITY_LABEL[i.priority] || i.priority,
      assigneeNames: (i.assignees || []).map(id => members[id] || id),
    };
  }

  return {
    all: issues.map(enrich),
    open: open.map(enrich),
    closed: closed.map(enrich),
    stateMap,
    closedIds,
    members,
  };
}

function reportExecutiveSummary(ctx) {
  const { all, open, closed } = ctx;
  const pct = all.length ? Math.round((closed.length / all.length) * 100) : 0;

  const byState = {};
  for (const i of open) byState[i.stateName] = (byState[i.stateName] || 0) + 1;

  const sinAsignar = open.filter(i => i.assigneeNames.length === 0);
  const detenidas  = open.filter(i => i.stateName.toLowerCase().includes("deten"));
  const altaPrio   = open.filter(i => i.priority === "urgent" || i.priority === "high");

  let out = `# Resumen Ejecutivo — ${PROJECT_NAME}\n`;
  out += `📅 ${today()}\n\n`;
  out += `## Métricas principales\n`;
  out += `| | |\n|---|---|\n`;
  out += `| Total de tarjetas | ${all.length} |\n`;
  out += `| Completadas | ${closed.length} (${pct}%) |\n`;
  out += `| **Abiertas** | **${open.length}** |\n`;
  out += `| Sin asignar | ${sinAsignar.length} |\n`;
  out += `| Detenidas / Bloqueadas | ${detenidas.length} |\n`;
  out += `| Alta prioridad abiertas | ${altaPrio.length} |\n\n`;

  out += `## Estado de tarjetas abiertas\n`;
  for (const [name, count] of Object.entries(byState)) {
    out += `- **${name}**: ${count}\n`;
  }

  if (detenidas.length > 0) {
    out += `\n## ⚠️ Tarjetas detenidas (requieren atención)\n`;
    for (const i of detenidas) {
      out += `- **#${i.sequence_id}** ${i.name} → ${i.assigneeNames.join(", ") || "Sin asignar"}\n`;
    }
  }

  if (sinAsignar.length > 0) {
    out += `\n## ⚠️ Tarjetas sin asignar\n`;
    for (const i of sinAsignar) {
      out += `- **#${i.sequence_id}** ${i.name} [${i.stateName}]\n`;
    }
  }

  out += `\n## Carga por persona\n`;
  const byPerson = {};
  for (const i of open) {
    for (const name of (i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"])) {
      byPerson[name] = (byPerson[name] || 0) + 1;
    }
  }
  const sorted = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    out += `- **${name}**: ${count} tarjeta(s)\n`;
  }

  return out;
}

function reportWorkload(ctx) {
  const { open } = ctx;
  const byPerson = {};
  for (const i of open) {
    const names = i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"];
    for (const name of names) {
      if (!byPerson[name]) byPerson[name] = [];
      byPerson[name].push(i);
    }
  }

  let out = `# Carga de trabajo — ${PROJECT_NAME}\n📅 ${today()}\n\n`;
  const sorted = Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length);

  for (const [name, items] of sorted) {
    const icon = name === "Sin asignar" ? "⚠️" : "👤";
    out += `## ${icon} ${name} — ${items.length} tarjeta(s)\n`;
    const sortedItems = [...items].sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
    for (const i of sortedItems) {
      const blocked = i.stateName.toLowerCase().includes("deten") ? " 🔴 BLOQUEADA" : "";
      out += `- **#${i.sequence_id}** [${i.stateName}] ${i.priorityLabel} — ${i.name}${blocked}\n`;
    }
    out += "\n";
  }
  return out;
}

function reportActiveIssues(ctx) {
  const active = ctx.open.filter(i =>
    !i.stateName.toLowerCase().includes("pendiente") &&
    !i.stateName.toLowerCase().includes("por hacer") &&
    !i.stateName.toLowerCase().includes("backlog")
  );

  let out = `# Actividades en curso — ${PROJECT_NAME}\n📅 ${today()}\n\n`;
  if (active.length === 0) {
    return out + "No hay tarjetas activas en este momento.\n";
  }

  const byState = {};
  for (const i of active) {
    if (!byState[i.stateName]) byState[i.stateName] = [];
    byState[i.stateName].push(i);
  }

  for (const [state, items] of Object.entries(byState)) {
    out += `## ${state} (${items.length})\n`;
    for (const i of items) {
      const assignees = i.assigneeNames.join(", ") || "Sin asignar";
      out += `- **#${i.sequence_id}** ${i.name}\n`;
      out += `  - Asignado: ${assignees} | Prioridad: ${i.priorityLabel}\n`;
    }
    out += "\n";
  }
  return out;
}

function reportBlockedIssues(ctx) {
  const blocked = ctx.open.filter(i =>
    i.stateName.toLowerCase().includes("deten") ||
    i.stateName.toLowerCase().includes("bloq")
  );

  let out = `# Tarjetas detenidas / bloqueadas — ${PROJECT_NAME}\n📅 ${today()}\n\n`;
  if (blocked.length === 0) {
    return out + "✅ No hay tarjetas bloqueadas en este momento.\n";
  }

  out += `> ⚠️ Hay **${blocked.length}** tarjeta(s) detenida(s) que requieren atención.\n\n`;
  for (const i of blocked) {
    const assignees = i.assigneeNames.join(", ") || "Sin asignar";
    out += `### #${i.sequence_id} — ${i.name}\n`;
    out += `- **Asignado:** ${assignees}\n`;
    out += `- **Prioridad:** ${i.priorityLabel}\n`;
    if (i.description) out += `- **Descripción:** ${i.description.slice(0, 200)}\n`;
    out += "\n";
  }
  return out;
}

function reportByPriority(ctx) {
  const { open } = ctx;
  let out = `# Tarjetas por prioridad — ${PROJECT_NAME}\n📅 ${today()}\n\n`;

  const priorities = ["urgent", "high", "medium", "low", "none"];
  for (const p of priorities) {
    const items = open.filter(i => i.priority === p);
    if (items.length === 0) continue;
    out += `## ${PRIORITY_LABEL[p]} (${items.length})\n`;
    for (const i of items) {
      const assignees = i.assigneeNames.join(", ") || "Sin asignar";
      out += `- **#${i.sequence_id}** [${i.stateName}] ${i.name} — ${assignees}\n`;
    }
    out += "\n";
  }
  return out;
}

function reportGantt(ctx) {
  const { all } = ctx;

  let out = `# Diagrama de Gantt — ${PROJECT_NAME}\n📅 ${today()}\n\n`;
  out += "```mermaid\ngantt\n";
  out += `    title ${PROJECT_NAME}\n`;
  out += "    dateFormat YYYY-MM-DD\n\n";

  const stateGroups = {};
  for (const i of all) {
    const g = i.stateName;
    if (!stateGroups[g]) stateGroups[g] = [];
    stateGroups[g].push(i);
  }

  let taskIdx = 0;
  for (const [state, items] of Object.entries(stateGroups)) {
    out += `    section ${state}\n`;
    for (const i of items) {
      const title = i.name.slice(0, 45).replace(/:/g, " ").replace(/,/g, " ");
      const start = i.start_date || i.created_at?.slice(0, 10) || "2026-01-01";
      const end   = i.due_date  || (() => {
        const d = new Date(start);
        d.setDate(d.getDate() + 14);
        return d.toISOString().slice(0, 10);
      })();

      const isCompleted = ctx.closedIds.has(i.state);
      const isBlocked   = i.stateName.toLowerCase().includes("deten");
      const isActive    = !isCompleted && !isBlocked;

      const modifier = isCompleted ? "done, " : isBlocked ? "crit, " : isActive && !i.stateName.toLowerCase().includes("pendiente") && !i.stateName.toLowerCase().includes("por hacer") ? "active, " : "";
      out += `    ${title} :${modifier}task${taskIdx++}, ${start}, ${end}\n`;
    }
  }
  out += "```\n\n";

  const sinFechas = all.filter(i => !i.start_date && !i.due_date);
  if (sinFechas.length > 0) {
    out += `> ℹ️ **${sinFechas.length} tarjeta(s) sin fechas definidas** — se usó fecha de creación + 14 días como estimado.\n`;
    out += `> Para mayor precisión, agrega fechas de inicio y vencimiento en Plane.\n`;
  }
  return out;
}

// --- Servidor MCP ---
const server = new Server(
  { name: "plane-assistant", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_executive_summary",
      description: "Resumen ejecutivo del proyecto: métricas generales, porcentaje de avance, tarjetas bloqueadas, carga por persona. Úsalo para responder '¿cómo vamos?', '¿cuál es el estado del proyecto?', '¿dame un resumen'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_workload",
      description: "Distribución de tarjetas abiertas por persona. Úsalo para '¿quién tiene más trabajo?', '¿cómo está distribuido el equipo?', '¿carga de trabajo?'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_active_issues",
      description: "Tarjetas actualmente en progreso o en validación. Úsalo para '¿qué está haciendo el equipo?', '¿qué actividades hay en curso?'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_blocked_issues",
      description: "Tarjetas detenidas o bloqueadas. Úsalo para '¿hay bloqueadores?', '¿qué está parado?', '¿impedimentos?'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_issues_by_priority",
      description: "Tarjetas abiertas agrupadas por prioridad (urgente, alta, media, baja). Úsalo para '¿qué es lo más importante?', '¿qué tiene prioridad alta?'.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_gantt_chart",
      description: "Diagrama de Gantt del proyecto con todas las tarjetas. Úsalo para '¿dame un gantt?', '¿cronograma?', '¿timeline?'.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  checkConfig();

  const [issues, states, members] = await Promise.all([
    getAllIssues(),
    getStates(),
    getMembers(),
  ]);

  const ctx = buildContext(issues, states, members);
  let text;

  switch (request.params.name) {
    case "get_executive_summary":  text = reportExecutiveSummary(ctx); break;
    case "get_workload":           text = reportWorkload(ctx);         break;
    case "get_active_issues":      text = reportActiveIssues(ctx);     break;
    case "get_blocked_issues":     text = reportBlockedIssues(ctx);    break;
    case "get_issues_by_priority": text = reportByPriority(ctx);       break;
    case "get_gantt_chart":        text = reportGantt(ctx);            break;
    default:
      return { content: [{ type: "text", text: `Herramienta desconocida: ${request.params.name}` }], isError: true };
  }

  return { content: [{ type: "text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
