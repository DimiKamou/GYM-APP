import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import {
  useInviteTrainer,
  useInvites,
  useRevokeInvite,
  useTeam,
  useUpdateMember,
} from '@/data/hooks'
import { formatDate } from '@/domain/format'
import { normalizeText } from '@/domain/text'
import { currentLocale } from '@/i18n'
import type { WriteState } from '@/data/repo/types'
import type { Invite, MemberRole, Membership, Uuid } from '@/domain/types'
import { Avatar, Button, Card, Chip, EmptyState, Field, Icon, Input, Screen, Sheet, Spinner } from '@/ui'

/**
 * The coaches, their roles, and the two irreversible things an owner can do.
 *
 * Three properties this screen exists to get right:
 *
 * **The invite secret is shown exactly once.** The server stores `sha256(secret)`, so there is
 * no second read — not by the owner, not by support. The sheet says so on the same screen as
 * the link rather than in a help page, and offers a copy button plus a selectable field for
 * when the clipboard API is refused.
 *
 * **Owner-only actions are visible and disabled, not hidden.** A trainer who cannot find the
 * invite button assumes the app is broken and asks the owner for their password. One sentence
 * naming who can do it is what stops the shared login.
 *
 * **Ownership transfer is typed, not tapped.** It is the one action in this app the person
 * doing it cannot undo — after it, only the new owner can hand the role back — so it takes a
 * word typed by hand rather than a button a thumb can find by accident.
 */

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const subtitleStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
}

const sectionTitle: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 'var(--th-text-sm)',
  fontWeight: 600,
  color: 'var(--th-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

const rowTop: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, width: '100%' }

const nameCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  flex: '1 1 auto',
}

const nameStyle: CSSProperties = {
  fontSize: 'var(--th-text-md)',
  fontWeight: 600,
  color: 'var(--th-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const subStyle: CSSProperties = {
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const rowActions: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 10,
  paddingTop: 10,
  borderTop: '1px solid var(--th-line-soft)',
}

const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

function Notice({ text, tone }: { text: string; tone: 'ok' | 'bad' }) {
  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: 'var(--th-text-sm)',
        lineHeight: 1.45,
        color: tone === 'bad' ? 'var(--th-danger)' : 'var(--th-success)',
      }}
    >
      {text}
    </p>
  )
}

/** Deliberately loose. The server is the authority; this only catches a missing @ or a typo'd space. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * An invite's expiry is a courtesy line, not a coaching number, so slicing the instant to its
 * UTC date is good enough here — unlike `Session.localDate`, nothing is scheduled off it.
 */
function expiryDate(invite: Invite): string {
  return invite.expiresAt.slice(0, 10)
}

export function TeamScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { membership } = useAuth()
  const team = useTeam()
  const invites = useInvites()
  const invite = useInviteTrainer()
  const revoke = useRevokeInvite()
  const updateMember = useUpdateMember()

  const [inviting, setInviting] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState<Uuid | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)

  // Not memoised: the local repository edits its rows in place, so an array identity is
  // not evidence that the rows inside it are unchanged.
  const members = team.data ?? []

  /**
   * The role is read from the roster row rather than from the auth context: after a transfer
   * the context still holds the membership resolved at sign-in, and an ex-owner would keep
   * seeing owner-only buttons that the server now refuses.
   */
  const me = members.find((row) => row.id === membership?.id) ?? membership ?? null
  const isOwner = me?.role === 'owner'

  const successors = members.filter(
    (row) => row.id !== me?.id && row.status === 'active' && row.userId !== null,
  )

  const pending = invites.data ?? []

  const header = (
    <>
      <div style={headerRow}>
        <div>
          <h1 className="display" style={titleStyle}>
            {t('team.title')}
          </h1>
          <p style={subtitleStyle}>{t('team.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon="plus"
          disabled={!isOwner}
          // The card below says who can, in a sentence. This is the same answer attached to
          // the control itself, for the trainer who taps it before reading anything.
          title={isOwner ? undefined : t('team.ownerOnly')}
          onClick={() => {
            setNotice(null)
            setInviting(true)
          }}
        >
          {t('team.invite')}
        </Button>
      </div>
    </>
  )

  async function removeTrainer(row: Membership) {
    setConfirmingRemoval(null)
    const state = await updateMember.mutateAsync({
      membershipId: row.id,
      patch: { status: 'removed' },
    })
    setNotice(
      state === 'failed'
        ? { text: t('team.removeFailed'), tone: 'bad' }
        : { text: t('team.removeDone'), tone: 'ok' },
    )
  }

  return (
    <Screen label={t('team.title')} header={header} footerSafeArea={false}>
      {/* Named, not hidden: a trainer who cannot see why a button is dead asks for the
          owner's password, and a shared login is the failure this whole product is about. */}
      {!isOwner ? (
        <Card tone="flat">
          <p style={{ ...bodyText, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="alert" size={18} />
            <span>{t('team.ownerOnlyHint')}</span>
          </p>
        </Card>
      ) : null}

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      <h2 style={sectionTitle}>{t('team.roster')}</h2>

      {team.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : team.isError ? (
        <EmptyState
          icon="alert"
          title={t('team.loadFailed')}
          description={t('errors.genericBody')}
          action={
            <Button variant="secondary" icon="undo" onClick={() => void team.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div style={listStyle}>
          {members.map((row) => {
            const isMe = row.id === me?.id
            const removable = isOwner && !isMe && row.role !== 'owner'
            return (
              <Card key={row.id}>
                <div style={rowTop}>
                  <Avatar fullName={row.displayName} size={40} />
                  <span style={nameCol}>
                    <span style={nameStyle}>
                      {row.displayName}
                      {isMe ? ` · ${t('common.you')}` : ''}
                    </span>
                    <span style={subStyle}>{row.email}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Chip icon={row.role === 'owner' ? 'pin' : 'users'}>{t(`roles.${row.role}`)}</Chip>
                    {row.status !== 'active' ? <Chip>{t(`statuses.${row.status}`)}</Chip> : null}
                  </span>
                </div>

                {removable ? (
                  <div style={rowActions}>
                    {confirmingRemoval === row.id ? (
                      <>
                        <p style={bodyText}>
                          <strong>{t('team.removeConfirm')}</strong> {t('team.removeExplain')}
                        </p>
                        <Button
                          variant="danger"
                          icon="trash"
                          loading={updateMember.isPending}
                          disabled={updateMember.isPending}
                          onClick={() => void removeTrainer(row)}
                        >
                          {t('team.removeTrainer')}
                        </Button>
                        <Button variant="quiet" onClick={() => setConfirmingRemoval(null)}>
                          {t('common.cancel')}
                        </Button>
                      </>
                    ) : (
                      // One of the two survivors of the confirm-dialog cull: removing a
                      // trainer is not something a six-second undo toast can carry.
                      <Button
                        variant="dangerQuiet"
                        icon="trash"
                        onClick={() => {
                          setNotice(null)
                          setConfirmingRemoval(row.id)
                        }}
                      >
                        {t('team.removeTrainer')}
                      </Button>
                    )}
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      {isOwner ? (
        <Card tone="flat">
          <p style={bodyText}>
            <strong>{t('team.transfer')}</strong>
          </p>
          <p style={{ ...mutedText, marginTop: 6 }}>
            {successors.length === 0
              ? t('team.transferNoCandidates')
              : t('team.transferExplain', { name: successors[0].displayName })}
          </p>
          <div style={{ marginTop: 10 }}>
            <Button
              variant="dangerQuiet"
              icon="users"
              disabled={successors.length === 0}
              onClick={() => {
                setNotice(null)
                setTransferring(true)
              }}
            >
              {t('team.transfer')}
            </Button>
          </div>
        </Card>
      ) : null}

      <h2 style={sectionTitle}>{t('team.pendingInvites')}</h2>

      {invites.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : pending.length === 0 ? (
        <p style={mutedText}>{t('team.noPending')}</p>
      ) : (
        <div style={listStyle}>
          {pending.map((row) => (
            <Card key={row.id}>
              <div style={rowTop}>
                <span style={nameCol}>
                  <span style={nameStyle}>{row.email ?? t('team.openInvite')}</span>
                  <span style={subStyle}>
                    {t(`roles.${row.role}`)} ·{' '}
                    {t('team.expires', { date: formatDate(expiryDate(row), locale) })}
                  </span>
                </span>
                <Button
                  variant="dangerQuiet"
                  size="sm"
                  disabled={!isOwner || revoke.isPending}
                  title={isOwner ? undefined : t('team.ownerOnly')}
                  onClick={async () => {
                    const state = await revoke.mutateAsync(row.id)
                    setNotice(
                      state === 'failed'
                        ? { text: t('team.revokeFailed'), tone: 'bad' }
                        : { text: t('team.revokeDone'), tone: 'ok' },
                    )
                  }}
                >
                  {t('team.revoke')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <InviteSheet
        open={inviting}
        busy={invite.isPending}
        onClose={() => setInviting(false)}
        onInvite={(email, role) => invite.mutateAsync({ email, role })}
      />

      <TransferSheet
        open={transferring}
        candidates={successors}
        busy={updateMember.isPending}
        onClose={() => setTransferring(false)}
        onTransfer={async (successor) => {
          if (!me) return
          // ONE call, which promotes the successor and steps the current owner down together.
          // It cannot be two: the schema keeps at most one active owner, so promoting first is
          // refused and stepping down first is refused as leaving the gym ownerless — and a
          // client that died between two writes would leave a gym nobody can administer, which
          // is unfixable from inside the app. `transfer_ownership()` does both in one
          // transaction; the local repository mirrors it.
          const state = await updateMember.mutateAsync({
            membershipId: successor.id,
            patch: { role: 'owner' },
          })
          setTransferring(false)
          setNotice(
            state === 'failed'
              ? { text: t('team.transferFailed'), tone: 'bad' }
              : { text: t('team.transferDone'), tone: 'ok' },
          )
        }}
      />
    </Screen>
  )
}

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

interface InviteSheetProps {
  open: boolean
  busy: boolean
  onClose: () => void
  onInvite: (email: string, role: MemberRole) => Promise<{ state: WriteState; secret?: string }>
}

/** The fragment, never the query string: a `?invite=` link puts a bearer token in access logs. */
function inviteLink(secret: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/join#invite=${encodeURIComponent(secret)}`
}

function InviteSheet({ open, busy, onClose, onInvite }: InviteSheetProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('trainer')
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  useEffect(() => {
    if (open) return
    setEmail('')
    setRole('trainer')
    setError(null)
    setLink(null)
    setCopied(null)
  }, [open])

  async function send() {
    const address = email.trim()
    if (address === '') {
      setError(t('team.inviteEmailRequired'))
      return
    }
    if (!looksLikeEmail(address)) {
      setError(t('team.inviteEmailInvalid'))
      return
    }
    setError(null)
    const result = await onInvite(address, role)
    if (result.state === 'failed' || !result.secret) {
      setError(t('team.inviteFailed'))
      return
    }
    setLink(inviteLink(result.secret))
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied('yes')
    } catch {
      // Denied by permissions policy, or no clipboard API at all. The field below is
      // selectable, which is why this is a message and not a dead end.
      setCopied('no')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={link ? t('team.inviteCreated') : t('team.invite')}
      footer={
        link ? (
          <Button variant="primary" block onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : (
          <Button variant="primary" block loading={busy} disabled={busy} onClick={() => void send()}>
            {t('team.sendInvite')}
          </Button>
        )
      }
    >
      {link ? (
        <>
          <p style={{ ...bodyText, color: 'var(--th-danger)' }}>
            <strong>{t('team.inviteShownOnce')}</strong>
          </p>
          <p style={mutedText}>{t('team.inviteOnceWarning')}</p>

          <Field label={t('team.inviteLink')}>
            <Input value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
          </Field>

          <Button variant="secondary" block icon="copy" onClick={() => void copy(link)}>
            {t('team.copyLink')}
          </Button>
          {copied === 'yes' ? <Notice text={t('team.linkCopied')} tone="ok" /> : null}
          {copied === 'no' ? <Notice text={t('team.copyFailed')} tone="bad" /> : null}
        </>
      ) : (
        <>
          <Field label={t('team.inviteEmail')} required error={error ?? undefined}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) setError(null)
              }}
              placeholder={t('auth.emailPlaceholder')}
            />
          </Field>

          <Field label={t('team.inviteRole')}>
            {() => (
              <div style={chipRow}>
                {(['trainer', 'owner'] as const).map((value) => (
                  <Chip key={value} selected={role === value} onClick={() => setRole(value)}>
                    {t(`roles.${value}`)}
                  </Chip>
                ))}
              </div>
            )}
          </Field>
        </>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Ownership transfer
// ---------------------------------------------------------------------------

interface TransferSheetProps {
  open: boolean
  candidates: Membership[]
  busy: boolean
  onClose: () => void
  onTransfer: (successor: Membership) => Promise<void>
}

function TransferSheet({ open, candidates, busy, onClose, onTransfer }: TransferSheetProps) {
  const { t } = useTranslation()
  const word = t('team.transferConfirmWord')
  const [successorId, setSuccessorId] = useState<Uuid | null>(null)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setSuccessorId(null)
    setTyped('')
    setError(null)
  }, [open])

  const successor = candidates.find((row) => row.id === successorId) ?? null
  // Folded, so a coach whose keyboard is in Greek caps without accents still matches.
  const wordMatches = normalizeText(typed) === normalizeText(word)

  return (
    <Sheet open={open} onClose={onClose} title={t('team.transfer')}>
      {candidates.length === 0 ? (
        <p style={bodyText}>{t('team.transferNoCandidates')}</p>
      ) : (
        <>
          <Field label={t('team.transferChoose')}>
            {() => (
              <div style={chipRow}>
                {candidates.map((row) => (
                  <Chip
                    key={row.id}
                    selected={successorId === row.id}
                    onClick={() => {
                      setSuccessorId(row.id)
                      setError(null)
                    }}
                  >
                    {row.displayName}
                  </Chip>
                ))}
              </div>
            )}
          </Field>

          {successor ? (
            <>
              <p style={{ ...bodyText, color: 'var(--th-danger)' }}>
                {t('team.transferExplain', { name: successor.displayName })}
              </p>

              {/* Typed by hand, because this is the one action the person doing it cannot
                  take back — only the new owner can hand the role back afterwards. */}
              <Field
                label={t('common.confirm')}
                hint={t('team.transferTypeHint', { word })}
                error={error ?? undefined}
              >
                <Input
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value)
                    if (error) setError(null)
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </Field>

              <Button
                variant="danger"
                block
                loading={busy}
                disabled={busy}
                onClick={() => {
                  if (!wordMatches) {
                    setError(t('team.transferMismatch'))
                    return
                  }
                  void onTransfer(successor)
                }}
              >
                {t('team.transferTo', { name: successor.displayName })}
              </Button>
            </>
          ) : null}
        </>
      )}
    </Sheet>
  )
}
