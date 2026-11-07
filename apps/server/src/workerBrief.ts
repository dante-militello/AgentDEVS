export interface WorkerBriefInput {
  title: string
  task: string
  scope?: string
  branch: string
  repoPath: string
}

/** First message a worker receives. Kept on one paragraph per line so it survives the Windows command line. */
export function buildWorkerBrief({ title, task, scope, branch, repoPath }: WorkerBriefInput): string {
  return [
    `Sos un worker de AgentDEVS. Tu tarea: "${title}".`,
    `Trabajás en una worktree propia (rama ${branch}) del repo ${repoPath}. No toques otras ramas ni la carpeta principal del repo.`,
    `TAREA: ${task}`,
    scope
      ? `ALCANCE: solo podés modificar esto: ${scope}. Si necesitás tocar algo fuera de ese alcance, pará y explicá por qué en vez de hacerlo.`
      : 'ALCANCE: limitate a lo necesario para esta tarea; no hagas refactors ajenos.',
    'Hacé commits chicos y descriptivos en tu rama. No hagas merge ni push.',
    'Si algo no está claro o hay una decisión importante, preguntá antes de seguir.',
    'Cuando termines, cerrá con un REPORTE breve: qué hiciste, archivos tocados, cómo probarlo y qué quedó pendiente.',
  ].join('\n')
}
