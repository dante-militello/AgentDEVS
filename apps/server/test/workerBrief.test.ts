import { describe, expect, test } from 'vitest'
import { buildWorkerBrief } from '../src/workerBrief.js'

describe('buildWorkerBrief', () => {
  const base = { title: 'Login API', task: 'Agregar endpoint de login con Google', branch: 'agentdevs/login-api', repoPath: 'E:\\repo' }

  test('includes the contract: task, branch, no merge, final report', () => {
    const brief = buildWorkerBrief(base)
    expect(brief).toContain('Agregar endpoint de login con Google')
    expect(brief).toContain('agentdevs/login-api')
    expect(brief).toMatch(/No hagas merge ni push/)
    expect(brief).toMatch(/REPORTE/)
  })

  test('states the scope when given', () => {
    expect(buildWorkerBrief({ ...base, scope: 'src/auth/**' })).toContain('solo podés modificar esto: src/auth/**')
  })
})
