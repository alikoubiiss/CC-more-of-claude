---
tipo: proyecto
proyecto: {{slug}}
estado: idea
repo: {{repoPath}}
notebook: {{notebookId}}
puerto: {{port}}
nivel: 1
creado: {{date}}
cssclasses: [hq-proyecto]
---
# {{display}}

> [!abstract] Resumen
> Proyecto HQ `{{slug}}`, creado el {{date}}. Las tarjetas viven en `backlog/` del repo y se citan por ID (`TASK-n`).

## Qué es
Pendiente: ejecuta /idea.

## Enlaces
- Tablero: `cc board` en la terminal (puerto web opcional: {{port}})
- Repo: `{{repoPath}}`
- NotebookLM: `{{notebookId}}`

## Sesiones
```base
filters:
  and:
    - file.inFolder("Proyectos/{{slug}}/Sesiones")
views:
  - type: table
    name: Sesiones
    order:
      - file.name
      - fecha
    sort:
      - property: fecha
        direction: DESC
```

## Decisiones
```base
filters:
  and:
    - file.inFolder("Proyectos/{{slug}}/Decisiones")
views:
  - type: table
    name: Decisiones
    order:
      - file.name
      - fecha
    sort:
      - property: fecha
        direction: DESC
```

## Conocimiento relacionado
Enlaza aquí a mano las notas de `Conocimiento/...` que afecten a este proyecto.
