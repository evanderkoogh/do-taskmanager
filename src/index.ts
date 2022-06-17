import { PointInTime, TM_DurableObject, TM_DO_class, TM_Env, Task, TaskManager, taskId } from './types'
import { TaskContext } from './context'

export class TaskManagerImpl implements TaskManager {
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

  async getActualAlarm(): Promise<number | null> {
    return this.taskContext.getActualAlarm()
  }
}

function proxyStorage(storage: DurableObjectStorage, context: TaskContext): DurableObjectStorage {
  return new Proxy(storage, {
    get: (getTarget, prop, _receiver) => {
      if (prop === 'deleteAlarm') {
        return new Proxy(getTarget.deleteAlarm, {
          apply: (_target, _thisArg, _argArray): Promise<void> => {
            return context.deleteAlarm()
          },
        })
      } else if (prop === 'getAlarm') {
        return new Proxy(getTarget.getAlarm, {
          apply: (_target, _thisArg, _argArray): Promise<number | null> => {
            return context.getAlarm()
          },
        })
      } else if (prop === 'setAlarm') {
        return new Proxy(getTarget.setAlarm, {
          apply: (_target, _thisArg, [time]): Promise<void> => {
            return context.setAlarm(time as PointInTime)
          },
        })
      } else if (prop === 'deleteAlarm') {
        return new Proxy(getTarget.setAlarm, {
          apply: async (_target, _thisArg, argArray): Promise<void> => {
            await context.deleteAlarm()
            const deleteAll = storage[prop].bind(storage)
            return deleteAll(...argArray)
          },
        })
      } else {
        //@ts-ignore
        return storage[prop].bind(storage)
      }
    },
  })
}

function proxyState(state: DurableObjectState, context: TaskContext): DurableObjectState {
  return new Proxy(state, {
    get: (_target, prop, _receiver) => {
      if (prop === 'storage') {
        return proxyStorage(state.storage, context)
      } else {
        //@ts-ignore
        return state[prop]
      }
    },
  })
}

function proxyDO(targetDO: TM_DurableObject, context: TaskContext): TM_DurableObject {
  const proxy = new Proxy(targetDO, {
    get: (_target, prop, _receiver) => {
      if (prop === 'alarm') {
        return async () => {
          await context.alarm(targetDO)
        }
      } else {
        //@ts-ignore
        const value = targetDO[prop]
        if (typeof value === 'function') {
          value.bind(targetDO)
        }
        return value
      }
    },
  })
  return proxy
}

export function withTaskManager<T extends TM_Env>(do_class: TM_DO_class<T>): TM_DO_class<T> {
  const proxy = new Proxy(do_class, {
    construct: (target, [state, env, ...rest]) => {
      const context = new TaskContext(state)
      env.TASK_MANAGER = new TaskManagerImpl(context)
      const proxiedState = proxyState(state, context)
      const obj = new target(proxiedState, env, ...rest)
      console.log({ obj })
      const proxiedDO = proxyDO(obj, context)
      console.log({ proxiedDO })
      console.log(obj == proxiedDO)
      return proxiedDO
    },
  })
  return proxy
}

export type { Task, TaskManager, TM_DurableObject }
