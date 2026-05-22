# Plane Assistant MCP

Servidor MCP que conecta Claude Code con [Plane](https://plane.so) para consultar el estado de tus proyectos en lenguaje natural, desde la app de escritorio o el CLI.

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/TU-USUARIO/plane-mcp.git
cd plane-mcp
npm install
```

### 2. Configurar Claude Code

Agrega el servidor MCP en la configuración de Claude Code.

#### Opción A — Claude Code CLI / Desktop (archivo de configuración)

Edita (o crea) el archivo de configuración de Claude Code:

- **Linux / Mac:** `~/.claude/claude.json`  
- **Windows:** `%USERPROFILE%\.claude\claude.json`

Agrega lo siguiente (reemplaza los valores con los de tu proyecto):

```json
{
  "mcpServers": {
    "plane": {
      "command": "node",
      "args": ["/RUTA/COMPLETA/plane-mcp/src/index.js"],
      "env": {
        "PLANE_API_KEY": "plane_api_xxxxx",
        "PLANE_URL": "https://plane.tuempresa.com",
        "PLANE_WORKSPACE": "tu-workspace-slug",
        "PLANE_PROJECT_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "PLANE_PROJECT_NAME": "Nombre del Proyecto"
      }
    }
  }
}
```

> **¿Dónde encuentro estos datos?**
> - **API Key:** Plane → Perfil → Settings → API Tokens → Create Token
> - **URL:** La URL base de tu instancia de Plane
> - **Workspace Slug:** La parte de la URL después del dominio: `https://plane.so/ESTE-SLUG/projects/...`
> - **Project ID:** El UUID en la URL del proyecto: `.../projects/ESTE-UUID/issues/`
> - **Project Name:** El nombre que quieres ver en los reportes

#### Opción B — Claude Code Desktop (interfaz gráfica)

1. Abre Claude Code Desktop
2. Ve a **Settings → MCP Servers → Add Server**
3. Llena los campos:
   - **Name:** `plane`
   - **Command:** `node`
   - **Args:** `/RUTA/COMPLETA/plane-mcp/src/index.js`
   - **Environment variables:** los 5 valores de arriba

### 3. Reiniciar Claude Code

Cierra y vuelve a abrir Claude Code para que detecte el servidor MCP.

---

## Uso

Una vez configurado, simplemente pregunta en lenguaje natural en Claude Code:

| Pregunta | Qué hace |
|----------|----------|
| `¿cómo vamos con el proyecto?` | Resumen ejecutivo con métricas |
| `¿cuál es la carga de trabajo del equipo?` | Tarjetas por persona |
| `¿qué está haciendo el equipo ahorita?` | Actividades en progreso |
| `¿hay algo bloqueado?` | Tarjetas detenidas |
| `¿qué tiene prioridad alta?` | Tarjetas por prioridad |
| `dame un diagrama de gantt` | Gantt del proyecto |
| `dame un resumen para la junta` | Resumen ejecutivo |

No necesitas usar comandos especiales — Claude detecta automáticamente qué consultar en Plane según tu pregunta.

---

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior
- [Claude Code](https://claude.ai/code) (CLI o app de escritorio)
- Acceso a una instancia de Plane con API Key

---

## Actualizar

```bash
cd plane-mcp
git pull
npm install
```

Reinicia Claude Code después de actualizar.

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `PLANE_API_KEY` | Token de API de Plane | ✅ |
| `PLANE_URL` | URL base de la instancia | ✅ |
| `PLANE_WORKSPACE` | Slug del workspace | ✅ |
| `PLANE_PROJECT_ID` | UUID del proyecto | ✅ |
| `PLANE_PROJECT_NAME` | Nombre para mostrar en reportes | ❌ (default: "Proyecto") |
