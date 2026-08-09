// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toasty } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AdminApi, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import AdminPage from './AdminPage'
import { AuthProvider } from './AuthContext'
import { renderWithLocale } from './test/renderWithLocale'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {}; unobserve() {}; disconnect() {} } as typeof ResizeObserver
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {} as typeof PointerEvent
}

const settings = {
  signupsEnabled: true,
  siteName: '',
  instanceInstructions: '',
  announcement: '',
  banner: { text: '', color: 'info' as const },
  accentColor: '',
  modelPolicy: { defaultModelId: 'org-claude', disabledOrganizationModelIds: [] },
  resourceVendors: [],
  formats: [],
}

afterEach(() => document.body.replaceChildren())

describe('Admin model policy', () => {
  it('clears the default before disabling that model', async () => {
    const setDefaultModel = vi.fn<() => Promise<void>>(async () => {})
    const setOrganizationModelEnabled = vi.fn<(id: string, enabled: boolean) => Promise<void>>(async () => {})
    const adminApi = {
      getSettings: async () => settings,
      setDefaultModel,
      setOrganizationModelEnabled,
    } as unknown as RpcStub<AdminApi>
    const authenticatedApi = {
      getLocale: async () => 'zh-CN' as const,
      whoami: async () => ({ type: 'user', id: 'admin', name: 'Admin' }),
      amIAdmin: async () => true,
      getAdminApi: async () => adminApi,
      listModelCatalog: async () => [{
        id: 'org-claude', name: 'Company Claude', provider: 'anthropic' as const,
        source: 'organization' as const, enabled: true, isDefault: true, canDelete: false,
      }],
    } as unknown as RpcStub<AuthenticatedApi>
    const rendered = renderWithLocale(
      <Toasty><AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}><AdminPage /></AuthProvider></Toasty>,
      'zh-CN',
    )
    await act(async () => {})
    const modelsTab = [...rendered.container.querySelectorAll('button')].find((button) => button.textContent?.trim() === '模型')
    expect(modelsTab).toBeTruthy()
    await act(async () => { modelsTab?.click() })
    const toggle = rendered.container.querySelector('[role="switch"][aria-label="Company Claude"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    await act(async () => { toggle.click() })
    expect(setDefaultModel).toHaveBeenCalledWith('')
    expect(setOrganizationModelEnabled).toHaveBeenCalledWith('org-claude', false)
    expect(setDefaultModel.mock.invocationCallOrder[0]).toBeLessThan(setOrganizationModelEnabled.mock.invocationCallOrder[0])
    rendered.unmount()
  })
})
