import { PointInTime, TM_DurableObject, TM_class, TM_Env, TaskManager, taskId } from './types'
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
      tm_env.TASK_MANAGER = new TaskManagerImpl(context)
      const obj = new target(proxiedState, tm_env, ...rest)
      const proxiedDO = proxyDO(obj, context)
      return proxiedDO
    },
  })
}
