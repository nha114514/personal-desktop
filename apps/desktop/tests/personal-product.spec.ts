import { describe, expect, it, vi } from 'vitest'
import { desktopProductName, isPersonalDesktop } from '../scripts/desktop-personal-environment.mjs'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { resolveDesktopLocale } from '../src/locale.ts'
import { isPersonalDesktop as personalShell, PERSONAL_DESKTOP_NAME, personalDesktopLocale } from '../src/personal-product.ts'

// Installer adaptation is covered by installer-packaging; this checks configuration only.
vi.mock('../scripts/windows-directory-installer.mjs', () => ({ installWindowsDirectoryInstaller: vi.fn() }))

describe('personal Desktop distribution', () => {
  it('builds an unsigned Windows fork without upstream policy or signing credentials', () => {
    const environment = loadDesktopPackageEnvironment('win32', {
      DSH_DESKTOP_PERSONAL: '1', PATH: 'build-tools',
      DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN: 'https://upstream.example.com',
      DOWNLOAD_PROD_COS_SECRET_KEY: 'must-not-inherit',
    }, '/missing-personal-release-directory')
    expect(environment).toEqual({ DSH_DESKTOP_PERSONAL: '1', DSH_DESKTOP_APP_ID: 'local.personal.desktop', PATH: 'build-tools' })
    expect(() => validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' }, { unsigned: true })).not.toThrow()
    const config = createElectronBuilderConfig(environment, 'win32', 'x64')
    expect(config).toMatchObject({
      appId: 'local.personal.desktop', productName: 'Personal Desktop', publish: null,
      protocols: [{ name: 'Personal Desktop', schemes: ['personal-dsh'] }],
      extraMetadata: { dshPersonalDesktop: true, dshMandatoryUpdatePolicy: undefined },
      win: { forceCodeSigning: false },
    })
    expect(config.artifactName).toBe('personal-desktop-${version}-${os}-${arch}-unsigned.${ext}')
    expect(config.productName).toBe(desktopProductName(environment))
    expect(desktopProductName({})).toBe('DeepSeek Harness')
  })

  it('requires personal packaging to remain explicitly unsigned and Windows-only', () => {
    const environment = { DSH_DESKTOP_PERSONAL: '1', DSH_DESKTOP_APP_ID: 'local.personal.desktop' }
    expect(() => validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' })).toThrow('unsigned Windows')
    expect(() => validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' }, { prepareOnly: true })).not.toThrow()
    expect(() => createElectronBuilderConfig(environment, 'darwin', 'arm64')).toThrow('unsigned builds require Windows')
  })

  it('keeps ordinary release policy validation and rejects ambiguous personal flags', () => {
    expect(isPersonalDesktop({})).toBe(false)
    expect(isPersonalDesktop({ DSH_DESKTOP_PERSONAL: '0' })).toBe(false)
    expect(() => isPersonalDesktop({ DSH_DESKTOP_PERSONAL: 'yes' })).toThrow('0 or 1')
    expect(() => createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.original' }, 'win32', 'x64')).toThrow('MANDATORY_UPDATE_TEST_ORIGIN')
    for (const flag of [undefined, '0', '1']) {
      expect(personalShell({ DSH_DESKTOP_PERSONAL: flag })).toBe(isPersonalDesktop({ DSH_DESKTOP_PERSONAL: flag }))
    }
    expect(() => personalShell({ DSH_DESKTOP_PERSONAL: 'yes' })).toThrow('0 or 1')
    expect(PERSONAL_DESKTOP_NAME).toBe('Personal Desktop')
  })

  it.each(['en', 'zh-CN'])('relabels %s shell copy without changing the upstream dictionary', (language) => {
    const original = resolveDesktopLocale(language)
    const personal = personalDesktopLocale(original, true)
    expect(personal.messages.aboutProduct).toBe('Personal Desktop')
    expect(personal.messages.welcomeTitle).toBe('Personal Desktop')
    expect(personal.messages.quitApplication).toContain('Personal Desktop')
    expect(original.messages.aboutProduct).toBe('DeepSeek Harness')
    expect(personalDesktopLocale(original, false)).toBe(original)
  })
})
