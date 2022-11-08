import { AlarmTask, AllTasks, PointInTime, ProcessingError, taskId, TM_DurableObject } from './types'

import { decodeTime, ulidFactory } from 'ulid-workers'
import { serializeError } from 'serialize-error'

const ulid = ulidFactory({ monotonic: false })

function getTime(time: PointInTime): number {
  return typeof time === 'number' ? time : time.getTime()
}

export class TaskContext {
  private readonly storage: DurableObjectStorage
  private monoUlid = ulidFactory()
  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  private async setNextAlarm() {
    const nextAlarmKeyMap = await this.storage.list<taskId>({ prefix: '$$_tasks::', limit: 1 })
    const nextAlarmKeyArray = [...nextAlarmKeyMap.keys()]
    if (nextAlarmKeyArray.length > 0) {
      const time = decodeTime(nextAlarmKeyArray[0].replace('$$_tasks::', ''))
      await this.storage.setAlarm(time)
    }
  }

  private async scheduleTask(time: PointInTime, task: Partial<AllTasks>, setAlarm: boolean = true): Promise<taskId> {
    const epoch = getTime(time)
    task.scheduledAt = epoch
    task.id = this.monoUlid(epoch)
    await this.storage.put(`$$_tasks::${task.id}`, task)
    if (setAlarm) {
      await this.setNextAlarm()
    }
    return task.id
  }

  async scheduleTaskAt(time: PointInTime, context: any): Promise<taskId> {
    return this.scheduleTask(time, { attempt: 0, type: 'SINGLE', context })
  }

  async scheduleTaskIn(ms: number, context: any): Promise<taskId> {
    const time = Date.now() + ms
    return this.scheduleTask(time, { attempt: 0, type: 'SINGLE', context })
  }

  async scheduleTaskEvery(ms: number, context: any): Promise<taskId> {
    const time = Date.now() + ms
    return this.scheduleTask(time, { attempt: 0, type: 'RECURRING', interval: ms, context })
  }

  async cancelTask(id: taskId): Promise<void> {
    this.storage.delete(`$$_tasks::${id}`)
  }

  async setAlarm(time: PointInTime): Promise<void> {
    const epoch = getTime(time)
    this.storage.put('$$_tasks_alarm', epoch)
    await this.scheduleTask(time, { type: 'ALARM', attempt: 0, context: undefined })
  }

  async getAlarm(): Promise<number | undefined> {
    return this.storage.get<number>('$$_tasks_alarm')
  }

  async deleteAlarm(): Promise<void> {
    this.storage.delete('$$_tasks_alarm')
  }

  private async processTask(targetDO: TM_DurableObject, task: AllTasks): Promise<ProcessingError | void> {
    if (task.type === 'ALARM') {
      return this.processAlarm(targetDO, task)
    }
    try {
      return await targetDO.processTask(task)
    } catch (error) {
      return { error: serializeError(error), task }
    }
  }

  private async processAlarm(targetDO: TM_DurableObject, alarm: AlarmTask): Promise<ProcessingError | void> {
    console.log('Processing Alarm')
    try {
      if (alarm.scheduledAt && alarm.scheduledAt <= Date.now()) {
        await targetDO.alarm!()
        await this.storage.get<number>('$$_tasks_alarm')
      }
    } catch (error) {
      return { error, task: alarm }
    }
  }

  async alarm(targetDO: TM_DurableObject): Promise<void> {
    const encodedNow = ulid()
    const taskList = await this.storage.list<AllTasks>({
      prefix: '$$_tasks::',
      end: `$$_tasks::${encodedNow}}`,
    })
    const tasks = [...taskList.entries()]
    for (const [key, task] of tasks) {
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
          await this.scheduleTask(Date.now() + task.interval, task, false)
        }
      }
      await this.storage.delete(key)
    }
    await this.setNextAlarm()
  }
}
