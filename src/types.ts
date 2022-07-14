export type PointInTime = number | Date
export type taskId = string

export type Task = SingleTask | RecurringTask

export type AllTasks = Task | AlarmTask

export interface TaskBase {
  id: taskId
  context: any
  attempt: number
  scheduledAt?: number
  previousError?: any
}

export interface SingleTask extends TaskBase {
  type: 'SINGLE'
}

export interface RecurringTask extends TaskBase {
  type: 'RECURRING'
  interval: number
}

export interface AlarmTask extends TaskBase {
  type: 'ALARM'
  id: 'alarm'
}

export type ProcessingError = { error: any; task: AllTasks }

export interface TaskProcessor {
  processTask(task: Task): Promise<void>
}

export type TM_DurableObject = DurableObject & TaskProcessor

export type TM_Env = {
  TASK_MANAGER: TaskManager
}

export type TM_DO_class<T extends TM_Env> = {
  new (state: DurableObjectState, env: T, ...args: any[]): TM_DurableObject
}

export interface TaskManager {
  scheduleTaskAt(time: PointInTime, context: any): Promise<taskId>
  scheduleTaskIn(ms: number, context: any): Promise<taskId>
  scheduleTaskEvery(ms: number, context: any): Promise<taskId>
  cancelTask(taskId: taskId): Promise<void>
}
