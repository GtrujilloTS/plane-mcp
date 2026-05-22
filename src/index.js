#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY   = process.env.PLANE_API_KEY;
const BASE_URL  = (process.env.PLANE_URL || "").replace(/\/$/, "");
const WORKSPACE = process.env.PLANE_WORKSPACE;

function checkConfig() {
  const missing = [];
  if (!API_KEY)   missing.push("PLANE_API_KEY");
  if (!BASE_URL)  missing.push("PLANE_URL");
  if (!WORKSPACE) missing.push("PLANE_WORKSPACE");
  if (missing.length > 0) throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
}

async function planeGet(path) {
  const url = `${BASE_URL}/api/v1/workspaces/${WORKSPACE}${path}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Plane API ${res.status}: ${url}`);
  return res.json();
}

async function getAllIssues(projectId) {
  let page = 1, all = [], hasMore = true;
  while (hasMore) {
    const data = await planeGet(`/projects/${projectId}/issues/?per_page=100&page=${page}`);
    all = all.concat(data.results || []);
    hasMore = data.next_page_results;
    page++;
  }
  return all;
}

async function getStates(projectId) {
  const data = await planeGet(`/projects/${projectId}/states/`);
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

async function getProjects() {
  let page = 1, all = [], hasMore = true;
  while (hasMore) {
    const data = await planeGet(`/projects/?per_page=100&page=${page}`);
    all = all.concat(data.results || []);
    hasMore = data.next_page_results;
    page++;
  }
  return all;
}

// --- Helpers ---
const PRIORITY_LABEL = {
  urgent: "🔴 Urgente", high: "🟠 Alta", medium: "🟡 Media", low: "🔵 Baja", none: "⚪ Sin definir",
};

function priorityOrder(p) {
  return { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }[p] ?? 5;
}

function today() {
  return new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
}

function buildContext(issues, states, members) {
  const stateMap = {}, closedIds = new Set();
  for (const s of states) {
    stateMap[s.id] = s.name;
    if (s.group === "completed" || s.group === "cancelled") closedIds.add(s.id);
  }
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
    open: issues.filter(i => !closedIds.has(i.state)).map(enrich),
    closed: issues.filter(i => closedIds.has(i.state)).map(enrich),
    stateMap, closedIds, members,
  };
}

// --- Reportes ---
function reportExecutiveSummary(ctx, projectName) {
  const { all, open, closed } = ctx;
  const pct = all.length ? Math.round((closed.length / all.length) * 100) : 0;
  const byState = {};
  for (const i of open) byState[i.stateName] = (byState[i.stateName] || 0) + 1;
  const sinAsignar = open.filter(i => i.assigneeNames.length === 0);
  const detenidas  = open.filter(i => i.stateName.toLowerCase().includes("deten"));
  const altaPrio   = open.filter(i => i.priority === "urgent" || i.priority === "high");

  let out = `# Resumen Ejecutivo — ${projectName}\n📅 ${today()}\n\n`;
  out += `## Métricas principales\n| | |\n|---|---|\n`;
  out += `| Total de tarjetas | ${all.length} |\n`;
  out += `| Completadas | ${closed.length} (${pct}%) |\n`;
  out += `| **Abiertas** | **${open.length}** |\n`;
  out += `| Sin asignar | ${sinAsignar.length} |\n`;
  out += `| Detenidas / Bloqueadas | ${detenidas.length} |\n`;
  out += `| Alta prioridad abiertas | ${altaPrio.length} |\n\n`;
  out += `## Estado de tarjetas abiertas\n`;
  for (const [name, count] of Object.entries(byState)) out += `- **${name}**: ${count}\n`;
  if (detenidas.length > 0) {
    out += `\n## ⚠️ Tarjetas detenidas\n`;
    for (const i of detenidas) out += `- **#${i.sequence_id}** ${i.name} → ${i.assigneeNames.join(", ") || "Sin asignar"}\n`;
  }
  if (sinAsignar.length > 0) {
    out += `\n## ⚠️ Sin asignar\n`;
    for (const i of sinAsignar) out += `- **#${i.sequence_id}** ${i.name} [${i.stateName}]\n`;
  }
  out += `\n## Carga por persona\n`;
  const byPerson = {};
  for (const i of open)
    for (const name of (i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"]))
      byPerson[name] = (byPerson[name] || 0) + 1;
  for (const [name, count] of Object.entries(byPerson).sort((a, b) => b[1] - a[1]))
    out += `- **${name}**: ${count} tarjeta(s)\n`;
  return out;
}

function reportWorkload(ctx, projectName) {
  const byPerson = {};
  for (const i of ctx.open) {
    for (const name of (i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"])) {
      if (!byPerson[name]) byPerson[name] = [];
      byPerson[name].push(i);
    }
  }
  let out = `# Carga de trabajo — ${projectName}\n📅 ${today()}\n\n`;
  for (const [name, items] of Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length)) {
    out += `## ${name === "Sin asignar" ? "⚠️" : "👤"} ${name} — ${items.length} tarjeta(s)\n`;
    for (const i of [...items].sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority)))
      out += `- **#${i.sequence_id}** [${i.stateName}] ${i.priorityLabel} — ${i.name}${i.stateName.toLowerCase().includes("deten") ? " 🔴 BLOQUEADA" : ""}\n`;
    out += "\n";
  }
  return out;
}

function reportActiveIssues(ctx, projectName) {
  const active = ctx.open.filter(i =>
    !i.stateName.toLowerCase().includes("pendiente") &&
    !i.stateName.toLowerCase().includes("por hacer") &&
    !i.stateName.toLowerCase().includes("backlog")
  );
  let out = `# Actividades en curso — ${projectName}\n📅 ${today()}\n\n`;
  if (!active.length) return out + "No hay tarjetas activas en este momento.\n";
  const byState = {};
  for (const i of active) { if (!byState[i.stateName]) byState[i.stateName] = []; byState[i.stateName].push(i); }
  for (const [state, items] of Object.entries(byState)) {
    out += `## ${state} (${items.length})\n`;
    for (const i of items) out += `- **#${i.sequence_id}** ${i.name}\n  - ${i.assigneeNames.join(", ") || "Sin asignar"} | ${i.priorityLabel}\n`;
    out += "\n";
  }
  return out;
}

function reportBlockedIssues(ctx, projectName) {
  const blocked = ctx.open.filter(i => i.stateName.toLowerCase().includes("deten") || i.stateName.toLowerCase().includes("bloq"));
  let out = `# Tarjetas detenidas — ${projectName}\n📅 ${today()}\n\n`;
  if (!blocked.length) return out + "✅ No hay tarjetas bloqueadas.\n";
  out += `> ⚠️ **${blocked.length}** tarjeta(s) detenida(s) requieren atención.\n\n`;
  for (const i of blocked) {
    out += `### #${i.sequence_id} — ${i.name}\n- **Asignado:** ${i.assigneeNames.join(", ") || "Sin asignar"}\n- **Prioridad:** ${i.priorityLabel}\n\n`;
  }
  return out;
}

function reportByPriority(ctx, projectName) {
  let out = `# Por prioridad — ${projectName}\n📅 ${today()}\n\n`;
  for (const p of ["urgent", "high", "medium", "low", "none"]) {
    const items = ctx.open.filter(i => i.priority === p);
    if (!items.length) continue;
    out += `## ${PRIORITY_LABEL[p]} (${items.length})\n`;
    for (const i of items) out += `- **#${i.sequence_id}** [${i.stateName}] ${i.name} — ${i.assigneeNames.join(", ") || "Sin asignar"}\n`;
    out += "\n";
  }
  return out;
}

function reportGantt(ctx, projectName) {
  let out = `# Diagrama de Gantt — ${projectName}\n📅 ${today()}\n\n\`\`\`mermaid\ngantt\n    title ${projectName}\n    dateFormat YYYY-MM-DD\n\n`;
  const byState = {};
  for (const i of ctx.all) { if (!byState[i.stateName]) byState[i.stateName] = []; byState[i.stateName].push(i); }
  let idx = 0;
  for (const [state, items] of Object.entries(byState)) {
    out += `    section ${state}\n`;
    for (const i of items) {
      const title = i.name.slice(0, 45).replace(/[,:]/g, " ");
      const start = i.start_date || i.created_at?.slice(0, 10) || "2026-01-01";
      const end   = i.due_date || (() => { const d = new Date(start); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })();
      const mod = ctx.closedIds.has(i.state) ? "done, " : i.stateName.toLowerCase().includes("deten") ? "crit, " : "active, ";
      out += `    ${title} :${mod}t${idx++}, ${start}, ${end}\n`;
    }
  }
  out += "```\n";
  const sinFechas = ctx.all.filter(i => !i.start_date && !i.due_date);
  if (sinFechas.length) out += `\n> ℹ️ ${sinFechas.length} tarjeta(s) sin fechas — se usó fecha de creación + 14 días como estimado.\n`;
  return out;
}

// --- Servidor MCP ---
const server = new Server(
  { name: "plane-assistant", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

const PROJECT_INPUT = {
  project_id:   { type: "string", description: "ID del proyecto a consultar (UUID)" },
  project_name: { type: "string", description: "Nombre del proyecto para mostrar en el reporte" },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_projects",
      description: "Lista todos los proyectos disponibles en el workspace. Llama a esta herramienta PRIMERO cuando el usuario no especifique un proyecto, para mostrarle las opciones y que elija.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_executive_summary",
      description: "Resumen ejecutivo del proyecto: métricas, avance, bloqueadores, carga por persona.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
    {
      name: "get_workload",
      description: "Distribución de tarjetas abiertas por persona.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
    {
      name: "get_active_issues",
      description: "Tarjetas actualmente en progreso o en validación.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
    {
      name: "get_blocked_issues",
      description: "Tarjetas detenidas o bloqueadas.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
    {
      name: "get_issues_by_priority",
      description: "Tarjetas abiertas agrupadas por prioridad.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
    {
      name: "get_gantt_chart",
      description: "Diagrama de Gantt del proyecto.",
      inputSchema: { type: "object", properties: PROJECT_INPUT, required: ["project_id", "project_name"] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  checkConfig();

  if (request.params.name === "list_projects") {
    const projects = await getProjects();
    if (!projects.length) return { content: [{ type: "text", text: "No se encontraron proyectos en este workspace." }] };
    let text = `# Proyectos disponibles en el workspace\n\n`;
    projects.forEach((p, idx) => {
      text += `${idx + 1}. **${p.name}**${p.description ? ` — ${p.description}` : ""}\n`;
      text += `   ID: \`${p.id}\`\n\n`;
    });
    return { content: [{ type: "text", text }] };
  }

  const { project_id, project_name } = request.params.arguments || {};
  if (!project_id) return { content: [{ type: "text", text: "Se requiere project_id. Usa list_projects primero." }], isError: true };

  const [issues, states, members] = await Promise.all([
    getAllIssues(project_id),
    getStates(project_id),
    getMembers(),
  ]);
  const ctx = buildContext(issues, states, members);
  const name = project_name || "Proyecto";
  let text;

  switch (request.params.name) {
    case "get_executive_summary":  text = reportExecutiveSummary(ctx, name); break;
    case "get_workload":           text = reportWorkload(ctx, name);         break;
    case "get_active_issues":      text = reportActiveIssues(ctx, name);     break;
    case "get_blocked_issues":     text = reportBlockedIssues(ctx, name);    break;
    case "get_issues_by_priority": text = reportByPriority(ctx, name);       break;
    case "get_gantt_chart":        text = reportGantt(ctx, name);            break;
    default:
      return { content: [{ type: "text", text: `Herramienta desconocida: ${request.params.name}` }], isError: true };
  }

  return { content: [{ type: "text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
