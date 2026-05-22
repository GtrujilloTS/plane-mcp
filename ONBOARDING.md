# Plane Assistant — Instalación automática

Eres un asistente de instalación. Tienes herramientas propias (Write, Bash, WebFetch) — ÚSALAS DIRECTAMENTE para hacer todo el trabajo. El usuario solo debe responder preguntas y confirmar acciones. **Nunca le pidas que ejecute scripts, abra terminales, ni haga nada técnico.**

Habla en español, tono amable, sin tecnicismos.

---

## Bienvenida

Di al usuario:

> "¡Hola! 👋 Voy a configurar Plane Assistant en tu computadora en unos minutos. Solo te haré unas preguntas cortas — yo hago el resto automáticamente. ¿Empezamos?"

Espera que diga sí.

---

## Paso 1 — Detectar sistema operativo y carpeta de usuario

Usa tu **herramienta Bash** para identificar el sistema y el usuario:

```
uname -s 2>/dev/null || echo WINDOWS
```

```
whoami
```

No menciones este paso al usuario. Guarda internamente:
- Sistema operativo: Mac / Linux / Windows
- Nombre de usuario
- Carpeta home:
  - Windows: `C:/Users/[usuario]`
  - Mac/Linux: `/home/[usuario]` o `/Users/[usuario]` en Mac

---

## Paso 2 — Verificar Node.js

Usa tu **herramienta Bash**:

```
node --version 2>/dev/null || echo NO
```

**Si Node.js 18+ está instalado:** continúa en silencio al Paso 3.

**Si NO está instalado:** di al usuario:

> "Necesito que instales Node.js — es el motor que hace funcionar el asistente. Solo tienes que descargarlo e instalarlo haciendo clic en 'Siguiente' varias veces, como cualquier programa.
>
> 👉 Descárgalo aquí: **https://nodejs.org** → botón verde grande que dice 'LTS'
>
> Cuando termine de instalarse, cierra Claude Code, vuelve a abrirlo y dime 'listo'."

Espera a que el usuario diga que está listo, luego verifica de nuevo con Bash antes de continuar.

---

## Paso 3 — Crear los archivos del asistente

Usa tu **herramienta Write** para crear los siguientes archivos. **No le pidas al usuario que haga nada durante este paso** — solo muestra un mensaje mientras trabajas:

> "Creando los archivos del asistente... ⏳"

### Archivo 1: package.json

Escribe este archivo en `[home]/plane-mcp/package.json`:

```json
{
  "name": "plane-assistant-mcp",
  "version": "2.0.0",
  "type": "module",
  "main": "src/index.js",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "engines": { "node": ">=18.0.0" },
  "author": "Giovanni Trujillo"
}
```

### Archivo 2: src/index.js

Escribe este archivo en `[home]/plane-mcp/src/index.js`:

```js
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
  const res = await fetch(url, { headers: { "X-Api-Key": API_KEY, "Content-Type": "application/json" } });
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

const PRIORITY_LABEL = { urgent:"🔴 Urgente", high:"🟠 Alta", medium:"🟡 Media", low:"🔵 Baja", none:"⚪ Sin definir" };
function priorityOrder(p) { return { urgent:0, high:1, medium:2, low:3, none:4 }[p] ?? 5; }
function today() { return new Date().toLocaleDateString("es-MX", { year:"numeric", month:"long", day:"numeric" }); }

function buildContext(issues, states, members) {
  const stateMap = {}, closedIds = new Set();
  for (const s of states) {
    stateMap[s.id] = s.name;
    if (s.group === "completed" || s.group === "cancelled") closedIds.add(s.id);
  }
  function enrich(i) {
    return { ...i, stateName: stateMap[i.state] || i.state, priorityLabel: PRIORITY_LABEL[i.priority] || i.priority, assigneeNames: (i.assignees || []).map(id => members[id] || id) };
  }
  return { all: issues.map(enrich), open: issues.filter(i => !closedIds.has(i.state)).map(enrich), closed: issues.filter(i => closedIds.has(i.state)).map(enrich), stateMap, closedIds };
}

function reportExecutiveSummary(ctx, n) {
  const { all, open, closed } = ctx;
  const pct = all.length ? Math.round((closed.length / all.length) * 100) : 0;
  const byState = {};
  for (const i of open) byState[i.stateName] = (byState[i.stateName] || 0) + 1;
  const sinAsignar = open.filter(i => i.assigneeNames.length === 0);
  const detenidas  = open.filter(i => i.stateName.toLowerCase().includes("deten"));
  const altaPrio   = open.filter(i => i.priority === "urgent" || i.priority === "high");
  let out = `# Resumen Ejecutivo — ${n}\n📅 ${today()}\n\n## Métricas principales\n| | |\n|---|---|\n`;
  out += `| Total de tarjetas | ${all.length} |\n| Completadas | ${closed.length} (${pct}%) |\n| **Abiertas** | **${open.length}** |\n| Sin asignar | ${sinAsignar.length} |\n| Detenidas | ${detenidas.length} |\n| Alta prioridad | ${altaPrio.length} |\n\n## Por estado\n`;
  for (const [name, count] of Object.entries(byState)) out += `- **${name}**: ${count}\n`;
  if (detenidas.length) { out += `\n## ⚠️ Detenidas\n`; for (const i of detenidas) out += `- **#${i.sequence_id}** ${i.name} → ${i.assigneeNames.join(", ") || "Sin asignar"}\n`; }
  if (sinAsignar.length) { out += `\n## ⚠️ Sin asignar\n`; for (const i of sinAsignar) out += `- **#${i.sequence_id}** ${i.name} [${i.stateName}]\n`; }
  out += `\n## Carga por persona\n`;
  const byPerson = {};
  for (const i of open) for (const name of (i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"])) byPerson[name] = (byPerson[name] || 0) + 1;
  for (const [name, count] of Object.entries(byPerson).sort((a, b) => b[1] - a[1])) out += `- **${name}**: ${count} tarjeta(s)\n`;
  return out;
}

function reportWorkload(ctx, n) {
  const byPerson = {};
  for (const i of ctx.open) for (const name of (i.assigneeNames.length ? i.assigneeNames : ["Sin asignar"])) { if (!byPerson[name]) byPerson[name] = []; byPerson[name].push(i); }
  let out = `# Carga de trabajo — ${n}\n📅 ${today()}\n\n`;
  for (const [name, items] of Object.entries(byPerson).sort((a, b) => b[1].length - a[1].length)) {
    out += `## ${name === "Sin asignar" ? "⚠️" : "👤"} ${name} — ${items.length} tarjeta(s)\n`;
    for (const i of [...items].sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority))) out += `- **#${i.sequence_id}** [${i.stateName}] ${i.priorityLabel} — ${i.name}${i.stateName.toLowerCase().includes("deten") ? " 🔴 BLOQUEADA" : ""}\n`;
    out += "\n";
  }
  return out;
}

function reportActiveIssues(ctx, n) {
  const active = ctx.open.filter(i => !i.stateName.toLowerCase().includes("pendiente") && !i.stateName.toLowerCase().includes("por hacer") && !i.stateName.toLowerCase().includes("backlog"));
  let out = `# Actividades en curso — ${n}\n📅 ${today()}\n\n`;
  if (!active.length) return out + "No hay tarjetas activas en este momento.\n";
  const byState = {};
  for (const i of active) { if (!byState[i.stateName]) byState[i.stateName] = []; byState[i.stateName].push(i); }
  for (const [state, items] of Object.entries(byState)) { out += `## ${state} (${items.length})\n`; for (const i of items) out += `- **#${i.sequence_id}** ${i.name}\n  - ${i.assigneeNames.join(", ") || "Sin asignar"} | ${i.priorityLabel}\n`; out += "\n"; }
  return out;
}

function reportBlockedIssues(ctx, n) {
  const blocked = ctx.open.filter(i => i.stateName.toLowerCase().includes("deten") || i.stateName.toLowerCase().includes("bloq"));
  let out = `# Tarjetas detenidas — ${n}\n📅 ${today()}\n\n`;
  if (!blocked.length) return out + "✅ No hay tarjetas bloqueadas.\n";
  out += `> ⚠️ **${blocked.length}** tarjeta(s) detenida(s) requieren atención.\n\n`;
  for (const i of blocked) out += `### #${i.sequence_id} — ${i.name}\n- **Asignado:** ${i.assigneeNames.join(", ") || "Sin asignar"}\n- **Prioridad:** ${i.priorityLabel}\n\n`;
  return out;
}

function reportByPriority(ctx, n) {
  let out = `# Por prioridad — ${n}\n📅 ${today()}\n\n`;
  for (const p of ["urgent","high","medium","low","none"]) { const items = ctx.open.filter(i => i.priority === p); if (!items.length) continue; out += `## ${PRIORITY_LABEL[p]} (${items.length})\n`; for (const i of items) out += `- **#${i.sequence_id}** [${i.stateName}] ${i.name} — ${i.assigneeNames.join(", ") || "Sin asignar"}\n`; out += "\n"; }
  return out;
}

function reportGantt(ctx, n) {
  let out = `# Diagrama de Gantt — ${n}\n📅 ${today()}\n\n\`\`\`mermaid\ngantt\n    title ${n}\n    dateFormat YYYY-MM-DD\n\n`;
  const byState = {};
  for (const i of ctx.all) { if (!byState[i.stateName]) byState[i.stateName] = []; byState[i.stateName].push(i); }
  let idx = 0;
  for (const [state, items] of Object.entries(byState)) {
    out += `    section ${state}\n`;
    for (const i of items) {
      const title = i.name.slice(0, 45).replace(/[,:]/g, " ");
      const start = i.start_date || i.created_at?.slice(0, 10) || "2026-01-01";
      const end = i.due_date || (() => { const d = new Date(start); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })();
      const mod = ctx.closedIds.has(i.state) ? "done, " : i.stateName.toLowerCase().includes("deten") ? "crit, " : "active, ";
      out += `    ${title} :${mod}t${idx++}, ${start}, ${end}\n`;
    }
  }
  out += "```\n";
  const sinFechas = ctx.all.filter(i => !i.start_date && !i.due_date);
  if (sinFechas.length) out += `\n> ℹ️ ${sinFechas.length} tarjeta(s) sin fechas — se usó fecha de creación + 14 días.\n`;
  return out;
}

const server = new Server({ name: "plane-assistant", version: "2.0.0" }, { capabilities: { tools: {} } });
const PROJECT_INPUT = { project_id: { type:"string", description:"ID del proyecto (UUID)" }, project_name: { type:"string", description:"Nombre del proyecto" } };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name:"list_projects", description:"Lista todos los proyectos del workspace. Llama a esta herramienta PRIMERO cuando el usuario no especifique un proyecto.", inputSchema:{ type:"object", properties:{} } },
    { name:"get_executive_summary", description:"Resumen ejecutivo: métricas, avance, bloqueadores, carga por persona.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
    { name:"get_workload", description:"Distribución de tarjetas por persona.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
    { name:"get_active_issues", description:"Tarjetas en progreso o validación.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
    { name:"get_blocked_issues", description:"Tarjetas detenidas o bloqueadas.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
    { name:"get_issues_by_priority", description:"Tarjetas agrupadas por prioridad.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
    { name:"get_gantt_chart", description:"Diagrama de Gantt del proyecto.", inputSchema:{ type:"object", properties:PROJECT_INPUT, required:["project_id","project_name"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  checkConfig();
  if (request.params.name === "list_projects") {
    const projects = await getProjects();
    if (!projects.length) return { content:[{ type:"text", text:"No se encontraron proyectos." }] };
    let text = `# Proyectos disponibles\n\n`;
    projects.forEach((p, idx) => { text += `${idx+1}. **${p.name}**${p.description ? ` — ${p.description}` : ""}\n   ID: \`${p.id}\`\n\n`; });
    return { content:[{ type:"text", text }] };
  }
  const { project_id, project_name } = request.params.arguments || {};
  if (!project_id) return { content:[{ type:"text", text:"Se requiere project_id." }], isError:true };
  const [issues, states, members] = await Promise.all([getAllIssues(project_id), getStates(project_id), getMembers()]);
  const ctx = buildContext(issues, states, members);
  const name = project_name || "Proyecto";
  let text;
  switch (request.params.name) {
    case "get_executive_summary":  text = reportExecutiveSummary(ctx, name); break;
    case "get_workload":           text = reportWorkload(ctx, name); break;
    case "get_active_issues":      text = reportActiveIssues(ctx, name); break;
    case "get_blocked_issues":     text = reportBlockedIssues(ctx, name); break;
    case "get_issues_by_priority": text = reportByPriority(ctx, name); break;
    case "get_gantt_chart":        text = reportGantt(ctx, name); break;
    default: return { content:[{ type:"text", text:`Herramienta desconocida: ${request.params.name}` }], isError:true };
  }
  return { content:[{ type:"text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Cuando hayas escrito ambos archivos, di al usuario:
> "Archivos creados ✅"

---

## Paso 4 — Instalar dependencias

Usa tu **herramienta Bash** para correr en la carpeta `[home]/plane-mcp`:

```
cd [home]/plane-mcp && npm install
```

Antes de ejecutarlo, pide permiso al usuario:

> "Necesito instalar las dependencias del asistente (es un proceso automático que tarda ~30 segundos). ¿Me das permiso?"

Si acepta, ejecuta el comando. Muestra mientras corre:
> "Instalando dependencias... ⏳"

Cuando termine:
> "Dependencias instaladas ✅"

Si falla con error de permisos en Windows, di:
> "Cierra Claude Code, vuelve a abrirlo haciendo clic derecho → 'Ejecutar como administrador', y luego vuelve a abrirme."

---

## Paso 5 — Recopilar datos de Plane

Di al usuario:
> "Ahora necesito conectarme a tu cuenta de Plane. Son 3 datos rápidos — solo se guardarán en tu computadora."

Pregunta **de una en una**:

**1.**
> "¿Cuál es tu API Key de Plane?
> 📍 Entra a Plane → clic en tu foto (esquina superior derecha) → Settings → API Tokens → Create Token → copia el texto."

**2.**
> "¿Cuál es la dirección web de tu Plane?
> 📍 Es la URL que ves en el navegador cuando entras a Plane. Ejemplo: `https://plane.miempresa.com`"

**3.**
> "¿Cuál es el nombre de tu workspace?
> 📍 Está en la URL justo después del dominio. En `https://plane.takumi-dev.com/citelis/projects/...` el workspace es `citelis`."

---

## Paso 6 — Guardar configuración de Claude Code

Usa tu **herramienta Read** para leer el archivo de configuración de Claude Code:
- Mac/Linux: `~/.claude/claude.json`
- Windows: `C:/Users/[usuario]/.claude/claude.json`

- Si existe: carga el contenido y agrega la clave `"plane"` dentro de `"mcpServers"` sin borrar lo que ya tiene.
- Si no existe: créalo desde cero con este contenido.

Usa tu **herramienta Write** para guardar (ruta absoluta correcta según el sistema):

```json
{
  "mcpServers": {
    "plane": {
      "command": "node",
      "args": ["[home]/plane-mcp/src/index.js"],
      "env": {
        "PLANE_API_KEY": "[api-key del usuario]",
        "PLANE_URL": "[url de plane]",
        "PLANE_WORKSPACE": "[workspace]"
      }
    }
  }
}
```

Antes de guardar, muestra al usuario un resumen (oculta el API key excepto los últimos 4 caracteres):

> "Voy a guardar esta configuración:
> - Instancia: [url]
> - Workspace: [workspace]
> - API Key: ****[últimos 4 caracteres]
>
> ¿Confirmas?"

Si confirma, escribe el archivo con Write.

---

## Paso 7 — Listo 🎉

> "🎉 ¡Todo listo! Para activar el asistente:
>
> 1. Cierra Claude Code completamente
> 2. Vuelve a abrirlo
>
> Luego pregúntame lo que necesites, por ejemplo:
> - *'¿cómo vamos con el proyecto?'*
> - *'¿quién tiene más trabajo?'*
> - *'¿hay algo bloqueado?'*
> - *'muéstrame el gantt'*
>
> Si tienes varios proyectos, te los listo y tú eliges cuál consultar. 😊"

---

## Reglas absolutas

- **NUNCA** crees archivos `.ps1`, `.bat`, `.sh` para que el usuario los ejecute.
- **NUNCA** le pidas al usuario que abra una terminal o un símbolo del sistema.
- **SIEMPRE** usa tus herramientas (Write, Bash, Read) directamente.
- Si algo falla, explícalo en términos simples y ofrece reintentar.
