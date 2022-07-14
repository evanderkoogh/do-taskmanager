import { AlarmTask, AllTasks, PointInTime, ProcessingError, taskId, TM_DurableObject } from './types'

function getTime(time: PointInTime): number {
  return typeof time === 'number' ? time : time.getTime()
}

export class TaskContext {
  private readonly storage: DurableObjectStorage
  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  private async setNextAlarm() {
    const nextAlarmKeyMap = await this.storage.list<taskId>({ prefix: '$$_tasks::alarm::', limit: 1 })
    const nextAlarmKeyArray = [...nextAlarmKeyMap.keys()]
    if (nextAlarmKeyArray.length > 0) {
      const time = parseInt(nextAlarmKeyArray[0].replace('$$_tasks::alarm::', ''))
      await this.storage.setAlarm(time)
    }
  }

  private async scheduleTask(time: PointInTime, task: AllTasks, setAlarm: boolean = true): Promise<taskId> {
    const epoch = getTime(time)
    task.scheduledAt = epoch
    const promises = [
      this.storage.put(`$$_tasks::id::${task.id}`, task),
      this.storage.put(`$$_tasks::alarm::${epoch}::id::${task.id}`, task.id),
    ]
    await Promise.all(promises)
    if (setAlarm) {
      await this.setNextAlarm()
    }
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
    console.log('Processing Alarm')
    try {
      if (alarm.scheduledAt && alarm.scheduledAt <= Date.now()) {
        return await targetDO.alarm()
      }
    } catch (error) {
      return { error, task: alarm }
    }
  }

  async alarm(targetDO: TM_DurableObject): Promise<void> {
    const alarms = await this.storage.list<string>({
      prefix: '$$_tasks::alarm::',
      end: `$$_tasks::alarm::${Date.now() + 50}`,
    })
    const getTaskPromises = [...alarms.entries()].map(async ([alarm_key, id]) => {
      const task_key = `$$_tasks::id::${id}`
      const task = await this.storage.get<AllTasks>(task_key)
      return { alarm_key, task_key, task }
    })
    const taskResults = await Promise.all(getTaskPromises)
    for (const entry of taskResults) {
      const { alarm_key, task_key, task } = entry
      if (task) {
        task.attempt++
        const error = await this.processTask(targetDO, task)
        if (error) {
          //retry in a minute
          task.previousError = error.error
          await this.scheduleTask(Date.now() + 60 * 1000, task, false)
        } else if (task.type === 'RECURRING') {
          task.attempt = 0
          task.previousError = undefined
          await this.scheduleTask(Date.now() + task.interval * 1000, task, false)
        }
      }
      this.storage.delete(task_key)
      await this.storage.delete(alarm_key)
    }
    await this.setNextAlarm()
  }
}
