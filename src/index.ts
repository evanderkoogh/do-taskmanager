type PointInTime = number | Date
type taskId = string

export type Task = SingleTask | RecurringTask

type AllTasks = Task | AlarmTask

interface TaskBase {
  id: taskId
  context: any
  attempt: number
  scheduledAt?: number
  previousError?: any
}

interface SingleTask extends TaskBase {
  type: 'SINGLE'
}

interface RecurringTask extends TaskBase {
  type: 'RECURRING'
  interval: number
}

interface AlarmTask extends TaskBase {
  id: 'alarm'
  type: 'ALARM'
}

type ProcessingError = { error: any; task: AllTasks }

type TM_Env = { TASK_MANAGER: TaskManager } & Record<string, any>

export interface TaskProcessor {
  processTask: (task: Task) => Promise<void>
  alarm: () => void
}

type TM_DurableObject = DurableObject & TaskProcessor

type TM_class = { new (state: DurableObjectState, env: TM_Env, ...args: any[]): TM_DurableObject }

export class TaskManager {
  constructor(private taskContext: TaskContext) {}

  async scheduleTaskAt(time: PointInTime, context: any): Promise<taskId> {
    return this.taskContext.scheduleTaskAt(time, context)
  }

  async scheduleTaskIn(ms: number, context: any): Promise<taskId> {
    return this.taskContext.scheduleTaskIn(ms, context)
  }

  async scheduleTaskEvery(ms: number, context: any): Promise<taskId> {
    return this.taskContext.scheduleTaskEvery(ms, context)
  }

  async cancelTask(id: taskId): Promise<void> {
    return this.taskContext.cancelTask(id)
  }
}

function getTime(time: PointInTime): number {
  return typeof time === 'number' ? time : time.getTime()
}

class TaskContext {
  private readonly storage: DurableObjectStorage
  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  private async scheduleTask(time: PointInTime, task: AllTasks): Promise<taskId> {
    const epoch = getTime(time)
    const promises = [
      this.storage.put(`$$_tasks::id::${task.id}`, task),
      this.storage.put(`$$_tasks::alarm::${epoch}`, task.id),
    ]
    await Promise.all(promises)
    return task.id
  }

  async scheduleTaskAt(time: PointInTime, context: any): Promise<taskId> {
    return this.scheduleTask(time, { id: crypto.randomUUID(), attempt: 0, type: 'SINGLE', context })
  }

  async scheduleTaskIn(sec: number, context: any): Promise<taskId> {
    const time = Date.now() + sec * 1000
    return this.scheduleTask(time, { id: crypto.randomUUID(), attempt: 0, type: 'SINGLE', context })
  }

  async scheduleTaskEvery(sec: number, context: any): Promise<taskId> {
    const time = Date.now() + sec * 1000
    return this.scheduleTask(time, { id: crypto.randomUUID(), attempt: 0, type: 'RECURRING', interval: sec, context })
  }

  async cancelTask(id: taskId): Promise<void> {
    await this.storage.delete(`$$_tasks::id::${id}`)
  }

  async setAlarm(time: PointInTime): Promise<void> {
    const epoch = getTime(time)
    await this.scheduleTask(time, { id: 'alarm', type: 'ALARM', attempt: 0, context: undefined })
  }

  async getAlarm(): Promise<number | null> {
    const task = await this.storage.get<AlarmTask>('$$_tasks::id::alarm')
    return task && task.scheduledAt ? task.scheduledAt : null
  }

  async deleteAlarm(): Promise<void> {
    await this.cancelTask('alarm')
  }

  private async processTask(targetDO: TM_DurableObject, task: AllTasks): Promise<ProcessingError | void> {
    if (task.type === 'ALARM') {
      return this.processAlarm(targetDO, task)
    }
    try {
      return await targetDO.processTask(task)
    } catch (error) {
      return { error, task }
    }
  }

  private async processAlarm(targetDO: TM_DurableObject, alarm: AlarmTask): Promise<ProcessingError | void> {
    try {
      return await targetDO.alarm()
    } catch (error) {
      return { error, task: alarm }
    }
  }

  async alarm(targetDO: TM_DurableObject): Promise<void> {
    const alarms = await this.storage.list<string>({
      prefix: '$$_tasks::alarm::',
      end: `$$_tasks::alarm::${Date.now() + 50}`,
    })
    const getTaskPromises = [...alarms.entries()].map(async ([key, id]) => {
      const task = await this.storage.get<AllTasks>(`$$_tasks::id::${id}`)
      return { key, task }
    })
    const taskResults = await Promise.all(getTaskPromises)
    for (const entry of taskResults) {
      const { key, task } = entry
      if (task) {
        task.attempt++
        const error = await this.processTask(targetDO, task)
        if (error) {
          //retry in a minute
          task.previousError = error
          await this.scheduleTask(Date.now() + 60 * 1000, task)
        } else if (task.type === 'RECURRING') {
          task.attempt = 0
          task.previousError = undefined
          await this.scheduleTask(Date.now() + task.interval * 1000, task)
        }
      }
      await this.storage.delete(key)
    }
  }
}

function proxyState(state: DurableObjectState, context: TaskContext): DurableObjectState {
  const storage = state.storage
  storage.deleteAlarm = new Proxy(storage.deleteAlarm, {
    apply: (_target, _thisArg, _argArray): Promise<void> => {
      return context.deleteAlarm()
    },
  })
  storage.getAlarm = new Proxy(storage.getAlarm, {
    apply: (_target, _thisArg, _argArray): Promise<number | null> => {
      return context.getAlarm()
    },
  })
  storage.setAlarm = new Proxy(storage.setAlarm, {
    apply: (_target, _thisArg, [time]): Promise<void> => {
      return context.setAlarm(time as PointInTime)
    },
  })
  return state
}

function proxyDO(targetDO: TM_DurableObject, context: TaskContext): TM_DurableObject {
  targetDO.alarm = new Proxy(targetDO.alarm, {
    apply: (_target, thisArg, _argArray): Promise<void> => {
      return context.alarm(thisArg)
    },
  })
  return targetDO
}

export function withTaskManager(do_class: TM_class): TM_class {
  return new Proxy(do_class, {
    construct: (target, [state, env, ...rest]) => {
      const context = new TaskContext(state)
      const proxiedState = proxyState(state, context)
      const tm_env = env as TM_Env
      tm_env.TASK_MANAGER = new TaskManager(context)
      const obj = new target(proxiedState, tm_env, ...rest)
      const proxiedDO = proxyDO(obj, context)
      return proxiedDO
    },
  })
}
