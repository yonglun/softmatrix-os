import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi, AiChatAuthorInfo, SupportedLocale } from '@gadgets/workshop-shared/api'
import { useLocale } from './i18n/LocaleProvider'

interface AuthContextType {
  authenticatedApi: RpcStub<AuthenticatedApi>
  logout: () => void
  /** Current user info, fetched once on mount. Null while loading. */
  currentUser: AiChatAuthorInfo | null
  /** Whether the current user is a deployment admin. False while loading / for non-admins. */
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

const authenticatedLocaleReads = new WeakMap<
  RpcStub<AuthenticatedApi>, Promise<SupportedLocale | null>
>();

interface AuthProviderProps {
  children: ReactNode
  authenticatedApi: RpcStub<AuthenticatedApi>
  onLogout: () => void
}

export function AuthProvider({ children, authenticatedApi, onLogout }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const { locale: currentLocale, setLocale, registerAuthenticatedApi } = useLocale()
  const currentLocaleRef = useRef(currentLocale)
  currentLocaleRef.current = currentLocale
  const [localeReady, setLocaleReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLocaleReady(false)
    registerAuthenticatedApi(authenticatedApi)
    let pending = authenticatedLocaleReads.get(authenticatedApi)
    if (!pending) {
      pending = Promise.resolve().then(() => authenticatedApi.getLocale()).then((locale) =>
        locale === 'en' || locale === 'zh-CN' ? locale : null,
      )
      authenticatedLocaleReads.set(authenticatedApi, pending)
    }
    pending.then((serverLocale) => {
      if (cancelled) return
      // A null preference means legacy storage: retain the local selection and persist it as the
      // authenticated preference so subsequent sessions do not need to migrate again.
      setLocale(serverLocale ?? currentLocaleRef.current)
      setLocaleReady(true)
    }).catch(() => {
      if (!cancelled) setLocaleReady(true)
    })
    return () => {
      cancelled = true
      registerAuthenticatedApi(null)
    }
  }, [authenticatedApi, registerAuthenticatedApi, setLocale])

  useEffect(() => {
    let cancelled = false
    authenticatedApi.whoami().then((info) => {
      if (!cancelled) setCurrentUser(info)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authenticatedApi])

  useEffect(() => {
    let cancelled = false
    authenticatedApi.amIAdmin().then((admin) => {
      if (!cancelled) setIsAdmin(admin)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authenticatedApi])

  if (!localeReady) return null

  return (
    <AuthContext.Provider value={{ authenticatedApi, logout: onLogout, currentUser, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthenticatedApi() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuthenticatedApi must be used within an AuthProvider')
  }
  return context
}

/** Returns the auth context when inside an AuthProvider, or null on public pages. */
export function useOptionalAuthenticatedApi(): AuthContextType | null {
  return useContext(AuthContext)
}
