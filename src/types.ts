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
  id: 'alarm'
  type: 'ALARM'
}

export type ProcessingError = { error: any; task: AllTasks }

export type TM_Env = { TASK_MANAGER: TaskManager } & Record<string, any>

export interface TaskProcessor {
  processTask: (task: Task) => Promise<void>
  alarm: () => void
}

export type TM_DurableObject = DurableObject & TaskProcessor

export type TM_class = { new (state: DurableObjectState, env: TM_Env, ...args: any[]): TM_DurableObject }

export interface TaskManager {
  scheduleTaskAt(time: PointInTime, context: any): Promise<taskId>
  scheduleTaskIn(ms: number, context: any): Promise<taskId>
  scheduleTaskEvery(ms: number, context: any): Promise<taskId>
}
