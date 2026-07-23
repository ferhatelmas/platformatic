import assert from 'node:assert'
import { test } from 'node:test'
import { DynamicWorkersScaler } from '../lib/worker-scaler.js'
import { kApplicationId, kId, kLastWorkerScalerELU, kWorkerStartTime, kWorkerStatus } from '../lib/worker/symbols.js'

test('applies the minimum workers after a dynamically added application starts', async t => {
  const updates = []
  const runtime = createRuntime({
    async updateApplicationsResources (applications) {
      updates.push(applications)
    }
  })
  const scaler = new DynamicWorkersScaler(runtime, { maxMemory: 1 })

  await scaler.start()
  t.after(() => scaler.stop())

  await scaler.add({
    id: 'application',
    workers: { dynamic: true, minimum: 3, maximum: 4 }
  })

  assert.deepStrictEqual(updates, [])

  await scaler.applyPendingUpdate('application')

  assert.deepStrictEqual(updates, [[{ application: 'application', workers: 3 }]])
})

test('logs worker health errors and refreshes the health check timeout', async t => {
  const error = new Error('health check failed')
  const errors = []
  let healthCheck
  let refreshes = 0

  t.mock.method(globalThis, 'setTimeout', callback => {
    healthCheck = callback
    return {
      refresh () {
        refreshes++
      }
    }
  })

  const worker = {
    [kApplicationId]: 'application',
    [kId]: 'application:0',
    [kLastWorkerScalerELU]: undefined,
    [kWorkerStartTime]: 0,
    [kWorkerStatus]: 'started'
  }
  const runtime = createRuntime({
    logger: {
      error (details, message) {
        errors.push({ details, message })
      },
      info () {},
      warn () {}
    },
    async getWorkers () {
      return { 'application:0': { raw: worker } }
    },
    async getWorkerHealth () {
      throw error
    }
  })
  const scaler = new DynamicWorkersScaler(runtime, { maxMemory: 1, gracePeriod: 0 })

  await scaler.start()
  t.after(() => scaler.stop())

  await healthCheck()

  assert.deepStrictEqual(errors, [{ details: { err: error }, message: 'Failed to get health for worker' }])
  assert.strictEqual(refreshes, 1)
})

function createRuntime (overrides = {}) {
  return {
    logger: {
      error () {},
      info () {},
      warn () {}
    },
    async getWorkers () {
      return {}
    },
    async updateApplicationsResources () {},
    ...overrides
  }
}
