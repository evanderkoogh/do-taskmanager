import {
  PointInTime,
  TM_DurableObject,
  TM_DO_class,
  TM_Env,
  Task,
  TaskManager,
  taskId,
  SingleTask,
  RecurringTask,
} from './types'
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
          apply: (_target, _thisArg, _argArray): Promise<number | undefined> => {
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
    get: (target, prop, receiver) => {
      if (prop === 'alarm') {
        return async () => {
          await context.alarm(receiver)
        }
      } else if (prop === '__task_context') {
        return context
      } else {
        //@ts-ignore
        const value = target[prop]
        if (typeof value === 'function') {
          value.bind(receiver)
        }
        return value
      }
    },
  })
  return proxy
}

const TM_PROP = Symbol('hasTM')

export function withTaskManager<T extends TM_Env<U>, U extends string = 'TASK_MANAGER'>(
  do_class: TM_DO_class<T>,
  binding_name?: U,
): TM_DO_class<T> {
  if ((do_class as any)[TM_PROP]) {
    return do_class
  } else {
    const proxy = new Proxy(do_class, {
      construct: (target, [state, env, ...rest]) => {
        const context = new TaskContext(state)
        env[binding_name] = new TaskManagerImpl(context)
        const proxiedState = proxyState(state, context)
        const obj = new target(proxiedState, env, ...rest)
        const proxiedDO = proxyDO(obj, context)
        return proxiedDO
      },
      get: (target, prop) => {
        if (prop === TM_PROP) {
          return true
        } else {
          return (target as any)[prop]
        }
      },
    })
    return proxy
  }
}

export type { PointInTime, SingleTask, Task, taskId, TaskManager, TM_DurableObject, RecurringTask }
