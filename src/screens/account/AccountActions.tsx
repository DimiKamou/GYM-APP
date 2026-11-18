import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AuthActionError } from '@/auth/AuthProvider'
import { useAuth } from '@/auth/useAuth'
import { Button, Card, Field, Input } from '@/ui'

/**
 * The account's own controls, the same on both panels: change the password, read the privacy
 * notice, delete the account.
 *
 * Deleting is the one action here with no way back, and it is behind a typed word rather than
 * a confirm tap — the rule this app keeps for removing a person, which this is. What it does
 * is said BEFORE the word is typed, per role, because the three roles lose different things:
 *
 *  - an owner loses nothing yet: the server refuses until ownership has been handed over;
 *  - a trainer's name stays on the sessions they wrote, and their address is erased;
 *  - an athlete's sessions stay with the gym's sheet, and their login is gone.
 *
 * Google Play requires this to be reachable from inside the app for any app that offers
 * sign-up; `/delete-account` is the web half of the same requirement.
 */

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const linkStyle: CSSProperties = {
  color: 'var(--th-accent)',
  fontWeight: 600,
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  fontSize: 'var(--th-text-sm)',
}

function Notice({ text, tone }: { text: string; tone: 'ok' | 'bad' }) {
  return (
    <p role="status" style={{ ...bodyText, color: tone === 'bad' ? 'var(--th-danger)' : 'var(--th-success)' }}>
      {text}
    </p>
  )
}

const MIN_PASSWORD = 8

export function AccountActions() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isDemo, membership, status, changePassword, deleteAccount } = useAuth()

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [passwordNotice, setPasswordNotice] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const word = t('account.deleteConfirmWord')
  const consequence =
    status === 'athlete'
      ? t('account.deleteAthlete')
      : membership?.role === 'owner'
        ? t('account.deleteOwner')
        : t('account.deleteTrainer')

  async function savePassword() {
    if (password.length < MIN_PASSWORD) {
      setPasswordNotice({ text: t('auth.passwordTooShort', { min: MIN_PASSWORD }), tone: 'bad' })
      return
    }
    if (password !== repeat) {
      setPasswordNotice({ text: t('account.passwordMismatch'), tone: 'bad' })
      return
    }
    setSavingPassword(true)
    try {
      await changePassword(password)
      setPassword('')
      setRepeat('')
      setPasswordNotice({ text: t('account.passwordChanged'), tone: 'ok' })
    } catch {
      setPasswordNotice({ text: t('account.passwordFailed'), tone: 'bad' })
    } finally {
      setSavingPassword(false)
    }
  }

  async function remove() {
    if (typed.trim().toUpperCase() !== word.toUpperCase()) {
      setDeleteError(t('settings.resetMismatch'))
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccount()
      navigate('/login', { replace: true })
    } catch (caught) {
      const code = caught instanceof AuthActionError ? caught.code : null
      setDeleteError(
        code === 'owner'
          ? t('account.deleteOwnerRefused')
          : code === 'missing'
            ? t('account.deleteUnavailable')
            : t('account.deleteFailed'),
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {!isDemo ? (
        <Card>
          <div style={stack}>
            {passwordOpen ? (
              <>
                <Field label={t('account.newPassword')} hint={t('auth.passwordHint', { min: MIN_PASSWORD })}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setPasswordNotice(null)
                    }}
                  />
                </Field>
                <Field label={t('account.repeatPassword')}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(event) => {
                      setRepeat(event.target.value)
                      setPasswordNotice(null)
                    }}
                  />
                </Field>
                {passwordNotice ? <Notice text={passwordNotice.text} tone={passwordNotice.tone} /> : null}
                <Button variant="primary" block loading={savingPassword} disabled={savingPassword} onClick={() => void savePassword()}>
                  {t('common.save')}
                </Button>
              </>
            ) : (
              <Button variant="secondary" block onClick={() => setPasswordOpen(true)}>
                {t('account.changePassword')}
              </Button>
            )}
          </div>
        </Card>
      ) : null}

      {/* A plain link, not the router's: the policy is a static page Google Play also links to,
          and the app has no route for it. */}
      <a href="/privacy.html" style={linkStyle}>
        {t('legal.privacyLink')}
      </a>

      <Card tone="flat">
        <div style={stack}>
          {isDemo ? (
            <p style={mutedText}>{t('settings.accountDemo')}</p>
          ) : deleteOpen ? (
            <>
              <p style={bodyText}>
                <strong>{t('account.deleteTitle')}</strong>
              </p>
              <p style={mutedText}>{consequence}</p>
              <Field label={t('settings.resetTyped')} hint={t('settings.resetTypeHint', { word })} error={deleteError ?? undefined}>
                <Input
                  value={typed}
                  autoComplete="off"
                  autoCapitalize="characters"
                  onChange={(event) => {
                    setTyped(event.target.value)
                    setDeleteError(null)
                  }}
                />
              </Field>
              <Button variant="danger" block loading={deleting} disabled={deleting} onClick={() => void remove()}>
                {t('account.deleteSubmit')}
              </Button>
              <Button variant="ghost" block disabled={deleting} onClick={() => setDeleteOpen(false)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button variant="dangerQuiet" icon="trash" block onClick={() => setDeleteOpen(true)}>
              {t('account.delete')}
            </Button>
          )}
        </div>
      </Card>
    </>
  )
}
