import { Switch, Tooltip } from '@cloudflare/kumo'
import { useTranslation } from 'react-i18next'

interface HookToggleProps {
  enabled: boolean
  disabled?: boolean
  onToggle: (enabled: boolean) => void
  size?: 'sm' | 'base' | 'lg'
}

// Enable/disable toggle for bound hooks. Used in the Connections tab, Activity log, and inline chat.
export function HookToggle({ enabled, disabled = false, onToggle, size = 'sm' }: HookToggleProps) {
  const { t } = useTranslation()
  return (
    <Tooltip content={enabled ? t('management.misc.disableHook') : t('management.misc.enableHook')} asChild>
      <span className="inline-flex items-center">
        <Switch
          checked={enabled}
          disabled={disabled}
          size={size}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label={enabled ? t('management.misc.disableHook') : t('management.misc.enableHook')}
        />
      </span>
    </Tooltip>
  )
}
