import { EventEmitter } from 'events'

class WSEmitter extends EventEmitter {}

export const campaignWsEmitter = new WSEmitter()
export const baileysWsEmitter = new WSEmitter()
