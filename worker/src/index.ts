import { Task, TaskManager, TM_DurableObject, withTaskManager } from '../../src'

export interface Env {
  TEST_DO: DurableObjectNamespace
  TASK_MANAGER: TaskManager
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/favicon.ico') {
      return new Response('Not found.', { status: 404 })
    } else {
      const id = env.TEST_DO.idFromName('test4')
      const stub = env.TEST_DO.get(id)
      return stub.fetch(request)
    }
  },
}

class TestDO implements TM_DurableObject {
  private storage: DurableObjectStorage
  constructor(state: DurableObjectState, protected readonly env: Env) {
    this.storage = state.storage
  }
  async processTask(task: Task): Promise<void> {
    console.log('Processing Task!')
    if (task.context === 'schedule-time1' && task.attempt < 2) {
      console.log('Failing task for the first time')
      throw new Error('Not this time!')
    }
    this.storage.put(`processed::receivedAt::${Date.now()}::${task.id}}`, task)
  }
  async alarm(): Promise<void> {
    console.log('Worker Alarm!')
    this.storage.put(`alarm::receivedAt::${Date.now()}`, 'alarm!')
  }

  async processFetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (pathname === '/status') {
      const list = await this.storage.list()
      const db = [...list.entries()]
      const obj = { currentTime: Date.now(), db }
      return new Response(JSON.stringify(obj, null, 2), { headers: { 'content-type': 'application/json' } })
    } else if (pathname === '/alarm') {
      const time = Date.now() + 1000 * 60
      this.storage.setAlarm(time)
      return new Response(`alarm scheduled for ${time}`)
    } else if (pathname === '/schedule') {
      const time1 = Date.now() + 1000 * 30
      const time2 = Date.now() + 1000 * 45
      const time3 = Date.now() + 1000 * 120
      this.env.TASK_MANAGER.scheduleTaskAt(time1, 'schedule-time1')
      this.env.TASK_MANAGER.scheduleTaskAt(time2, 'schedule-time2')
      const taskId3 = await this.env.TASK_MANAGER.scheduleTaskAt(time3, 'schedule-time3')
      this.env.TASK_MANAGER.scheduleTaskEvery(60, 'recurring')
      this.env.TASK_MANAGER.scheduleTaskIn(75, 'schedule-in')
      this.env.TASK_MANAGER.cancelTask(taskId3)
      return new Response('Scheduled!')
    } else if (pathname === '/delete') {
      this.storage.deleteAll()
      return new Response('All gone.. ')
    } else {
      return new Response('Not Found', { status: 404 })
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return this.processFetch(request)
    } catch (err) {
      return new Response(JSON.stringify(err), { status: 500 })
    }
  }
}

const Test_DO = withTaskManager(withTaskManager(TestDO))

export { Test_DO }
