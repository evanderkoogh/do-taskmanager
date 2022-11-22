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
  TaskBase,
} from './types'
import { TaskContext } from './context'

export class TaskManagerImpl implements TaskManager {
  constructor(private taskContext: TaskContext) {}

  async scheduleTaskAt(time: PointInTime, context: any, options?: Pick<TaskBase, 'retryInterval'>): Promise<taskId> {
    return this.taskContext.scheduleTaskAt(time, context, options)
  }

  async scheduleTaskIn(ms: number, context: any, options?: Pick<TaskBase, 'retryInterval'>): Promise<taskId> {
    return this.taskContext.scheduleTaskIn(ms, context, options)
  }

  async scheduleTaskEvery(ms: number, context: any, options?: Pick<TaskBase, 'retryInterval'>): Promise<taskId> {
    return this.taskContext.scheduleTaskEvery(ms, context, options)
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
        const value = state[prop]
        return typeof value === 'function' ? value.bind(state) : value
      }
    },
  })
}

function proxyDO(targetDO: TM_DurableObject, context: TaskContext): TM_DurableObject {
  const proxy = new Proxy(targetDO, {
    get: (target, prop, receiver) => {
      if (prop === 'alarm') {
        return async () => {
          await context.alarm(targetDO)
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

export function withTaskManager<T extends TM_Env>(do_class: TM_DO_class<T>): TM_DO_class<T> {
  if ((do_class as any)[TM_PROP]) {
    return do_class
  } else {
    const proxy = new Proxy(do_class, {
      construct: (target, [state, env, ...rest]) => {
        env = Object.assign({}, env)
        const context = new TaskContext(state)
        env.TASK_MANAGER = new TaskManagerImpl(context)
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
