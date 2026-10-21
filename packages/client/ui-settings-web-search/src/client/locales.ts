/** Locale bundles for the web-search provider's settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type WebSearchSettingsLocaleKey =
  | 'title' | 'description'
  | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'baseUrl' | 'baseUrlHint' | 'maxUses' | 'maxUsesHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'
  | 'crawlerDescription' | 'crawlerHint' | 'settingsFile' | 'settingsFileHint'
  | 'workbenchTitle' | 'licenseNotice' | 'platforms' | 'loginBrowser' | 'cancel'
  | 'statusSaved' | 'statusVerified' | 'statusExpired' | 'statusIdle' | 'statusLoggingIn' | 'statusCrawling'
  | 'keyword' | 'keywordPlaceholder' | 'count' | 'startCrawl'
  | 'runningLogs' | 'crawlResults' | 'noResults' | 'openLink' | 'clearLogs'

/** English copy. */
export const en: Record<WebSearchSettingsLocaleKey, string> = {
  title: 'Web search',
  description: 'Set up the DeepSeek search provider.',
  apiKey: 'API key',
  apiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  apiKeySet: 'A key is configured.',
  apiKeyUnset: 'No key is configured; only conversations using a DeepSeek Account model can search, through the default endpoint.',
  baseUrl: 'Endpoint',
  baseUrlHint: 'Leave blank to use the provider default.',
  maxUses: 'Max searches per request',
  maxUsesHint: 'How many times one request may search before it must answer.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  crawlerDescription: 'MediaCrawler searches supported media platforms. Better Crawler reads web search results and pages.',
  crawlerHint: 'All model routes share this backend. Platform searches use prefixes such as bili: or xhs: and may require platform login.',
  settingsFile: 'Shared settings file',
  settingsFileHint: 'The same local settings are used by Personal Desktop and the global crawler command.',
  workbenchTitle: 'MediaCrawler Native Workbench',
  licenseNotice: 'MediaCrawler is integrated under NON-COMMERCIAL LEARNING LICENSE 1.1 for personal learning and research only. Commercial use is strictly prohibited. Please comply with platform terms and compliance policies.',
  platforms: 'Supported Platforms',
  loginBrowser: 'Browser QR Login',
  cancel: 'Cancel',
  statusSaved: 'Saved Session (Unverified)',
  statusVerified: 'Logged In',
  statusExpired: 'Session Expired',
  statusIdle: 'Not Logged In',
  statusLoggingIn: 'Logging in…',
  statusCrawling: 'Crawling…',
  keyword: 'Keyword',
  keywordPlaceholder: 'e.g. Python tutorial, travel vlog...',
  count: 'Count',
  startCrawl: 'Start Crawl',
  runningLogs: 'Execution Logs',
  crawlResults: 'Crawled Results',
  noResults: 'No crawl results yet',
  openLink: 'Open Link',
  clearLogs: 'Clear Logs',
}

/** Simplified Chinese copy. */
export const zh: Record<WebSearchSettingsLocaleKey, string> = {
  title: '网页搜索',
  description: '设置 DeepSeek 的搜索提供方。',
  apiKey: 'API Key',
  apiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  apiKeySet: '已配置密钥。',
  apiKeyUnset: '未配置密钥；仅使用 DeepSeek 账号模型的对话可以通过默认接口地址搜索。',
  baseUrl: '接口地址',
  baseUrlHint: '留空则使用提供方默认地址。',
  maxUses: '单次请求最多搜索次数',
  maxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  crawlerDescription: 'MediaCrawler 搜索媒体平台，Better Crawler 搜索通用网页并读取正文。',
  crawlerHint: '所有模型共用这套检索后端。平台搜索可使用 bili: 或 xhs: 前缀，部分平台需要先登录。',
  settingsFile: '全局配置文件',
  settingsFileHint: 'Personal Desktop 和全局检索命令共用同一份本机配置。',
  workbenchTitle: 'MediaCrawler 原生工作台',
  licenseNotice: 'MediaCrawler 采用 NON-COMMERCIAL LEARNING LICENSE 1.1 协议集成，仅供个人学习研究，严禁商业用途。使用时请遵守目标平台使用条款与合规要求。',
  platforms: '支持平台',
  loginBrowser: '浏览器扫码登录',
  cancel: '取消',
  statusSaved: '已保存会话 (未核验)',
  statusVerified: '已登录',
  statusExpired: '登录已失效',
  statusIdle: '未登录',
  statusLoggingIn: '登录中…',
  statusCrawling: '抓取中…',
  keyword: '抓取关键词',
  keywordPlaceholder: '输入关键词，例如：Python教程、科技资讯',
  count: '抓取数量',
  startCrawl: '开始抓取',
  runningLogs: '运行日志',
  crawlResults: '抓取结果',
  noResults: '暂无抓取结果',
  openLink: '打开链接',
  clearLogs: '清空日志',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: WebSearchSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
