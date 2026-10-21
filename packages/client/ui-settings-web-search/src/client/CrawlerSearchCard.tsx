/** Settings and native workbench for the shared local retrieval backend and MediaCrawler. */
import { Button, SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { CrawlerSearchCardFace, MediaPlatformInfo } from './crawler-search-card-controller.ts'
import css from './CrawlerSearchCard.module.css'

export type CrawlerSearchCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.webSearch'> & InjectFace<CrawlerSearchCardFace>

const FALLBACK_PLATFORMS: MediaPlatformInfo[] = [
  { id: 'bili', name: 'B站', status: 'idle', busy: false },
  { id: 'xhs', name: '小红书', status: 'idle', busy: false },
  { id: 'dy', name: '抖音', status: 'idle', busy: false },
  { id: 'ks', name: '快手', status: 'idle', busy: false },
  { id: 'wb', name: '微博', status: 'idle', busy: false },
  { id: 'tieba', name: '百度贴吧', status: 'idle', busy: false },
  { id: 'zhihu', name: '知乎', status: 'idle', busy: false },
  { id: 'youtube', name: 'YouTube', status: 'saved', busy: false },
  { id: 'x', name: 'X / Twitter', status: 'idle', busy: false },
]

export function CrawlerSearchCard(props: CrawlerSearchCardProps) {
  const state = props.useCrawlerSearchCard(snapshot => snapshot)
  const crawlersState = props.useCrawlers(s => s)
  const snapshot = crawlersState.snapshot
  const { t } = props

  const [selectedPlatform, setSelectedPlatform] = useState<string>('bili')
  const [keyword, setKeyword] = useState<string>('')
  const [maxCount, setMaxCount] = useState<number>(5)

  if (props.view === 'summary') return t('crawlerDescription')

  const platforms = snapshot?.platforms ?? FALLBACK_PLATFORMS

  const currentPlatformInfo = platforms.find(p => p.id === selectedPlatform) ?? platforms[0]
  const isBusy = currentPlatformInfo?.busy || snapshot?.activePlatform !== undefined
  const isCurrentBusy = snapshot?.activePlatform === selectedPlatform

  const handleLogin = () => {
    if (props.login) {
      void props.login(selectedPlatform)
    }
  }

  const handleCancel = () => {
    if (props.cancel) {
      void props.cancel(selectedPlatform)
    }
  }

  const handleCrawl = (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyword.trim() || isBusy) return
    if (props.crawl) {
      void props.crawl(selectedPlatform, keyword.trim(), maxCount)
    }
  }

  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <p>{t('crawlerDescription')}</p>
      <p>{t('crawlerHint')}</p>
      <SettingsValueField
        id="plugin-config-crawler-settings-file"
        label={t('settingsFile')}
        hint={t('settingsFileHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={!state.writable}
        {...state.settingsFile}
        onEdit={text => props.edit('settingsFile', text)}
        onReset={() => props.resetField('settingsFile')}
      />

      <div className={css.workbench}>
        <div className={css.header}>
          <h3 className={css.title}>{t('workbenchTitle')}</h3>
          <p className={css.licenseNotice}>{t('licenseNotice')}</p>
        </div>

        <div>
          <h4 className={css.title} style={{ marginBottom: 8 }}>{t('platforms')}</h4>
          <div className={css.platformsGrid}>
            {platforms.map(p => {
              const isSelected = p.id === selectedPlatform
              const statusText = p.status === 'verified'
                ? t('statusVerified')
                : p.status === 'saved'
                  ? t('statusSaved')
                  : p.status === 'expired'
                    ? t('statusExpired')
                    : p.status === 'logging-in'
                      ? t('statusLoggingIn')
                      : p.status === 'crawling'
                        ? t('statusCrawling')
                        : t('statusIdle')
              const badgeClass = (p.status === 'verified' || p.status === 'saved')
                ? css.badgeSaved
                : (p.status === 'logging-in' || p.status === 'crawling')
                  ? css.badgeBusy
                  : css.badgeIdle

              return (
                <button
                  key={p.id}
                  type="button"
                  className={`${css.platformBtn} ${isSelected ? css.platformBtnSelected : ''}`}
                  onClick={() => setSelectedPlatform(p.id)}
                >
                  <span className={css.platformName}>{p.name}</span>
                  <span className={`${css.badge} ${badgeClass}`}>{statusText}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className={css.actionPanel}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {currentPlatformInfo?.name} ({currentPlatformInfo?.id})
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {isCurrentBusy ? (
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  {t('cancel')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={isBusy} onClick={handleLogin}>
                  {t('loginBrowser')}
                </Button>
              )}
            </div>
          </div>

          <form className={css.crawlForm} onSubmit={handleCrawl}>
            <input
              type="text"
              className={css.input}
              placeholder={t('keywordPlaceholder')}
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              disabled={isBusy}
            />
            <select
              className={css.select}
              value={maxCount}
              onChange={e => setMaxCount(Number(e.target.value))}
              disabled={isBusy}
            >
              <option value={3}>3条</option>
              <option value={5}>5条</option>
              <option value={10}>10条</option>
              <option value={20}>20条</option>
            </select>
            <Button variant="outline" size="sm" type="submit" disabled={isBusy || !keyword.trim()}>
              {t('startCrawl')}
            </Button>
          </form>
        </div>

        {snapshot?.logs && snapshot.logs.length > 0 && (
          <div>
            <h4 className={css.title} style={{ marginBottom: 6 }}>{t('runningLogs')}</h4>
            <div className={css.logBox}>
              {snapshot.logs.map(log => {
                const levelClass = log.level === 'error'
                  ? css.logLevelError
                  : log.level === 'warning'
                    ? css.logLevelWarning
                    : log.level === 'success'
                      ? css.logLevelSuccess
                      : css.logLevelInfo
                return (
                  <div key={log.id} className={css.logLine}>
                    <span className={css.logTime}>[{log.timestamp}]</span>
                    <span className={levelClass}>{log.message}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <h4 className={css.title} style={{ marginBottom: 8 }}>{t('crawlResults')}</h4>
          {(!snapshot?.results || snapshot.results.length === 0) ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
              {t('noResults')}
            </p>
          ) : (
            <div className={css.resultsList}>
              {snapshot.results.map(r => (
                <div key={r.id} className={css.resultItem}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className={css.resultTitle}
                    >
                      {r.title}
                    </a>
                    <span className={`${css.badge} ${css.badgeIdle}`}>{r.platform}</span>
                  </div>
                  {r.snippet && <p className={css.resultSnippet}>{r.snippet}</p>}
                  <div className={css.resultMeta}>
                    <span>{r.url}</span>
                    <span>{r.crawledAt?.slice(0, 19).replace('T', ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsForm>
  )
}
