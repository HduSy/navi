import { join } from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import { WikiFS } from '@navi/core'
import { NAVI_SCHEMA_MD } from './navi-schema.js'

let wikiInstance: WikiFS | null = null

export function getWiki(): WikiFS {
  if (wikiInstance) return wikiInstance
  const wikiRoot = join(app.getPath('userData'), 'wiki')
  if (!fs.existsSync(wikiRoot)) fs.mkdirSync(wikiRoot, { recursive: true })
  const naviMd = join(wikiRoot, 'navi.md')
  if (!fs.existsSync(naviMd)) {
    fs.writeFileSync(naviMd, NAVI_SCHEMA_MD, 'utf8')
  }
  wikiInstance = new WikiFS(wikiRoot)
  wikiInstance.init()
  return wikiInstance
}

export function getWikiRoot(): string {
  return join(app.getPath('userData'), 'wiki')
}
