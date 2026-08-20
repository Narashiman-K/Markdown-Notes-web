import { createRoot, type Root } from 'react-dom/client'

/**
 * Promise-based dialogs.
 *
 * The desktop build used native Windows message boxes. A browser has only
 * `window.confirm`, which is ugly, blocks the whole page, and cannot offer the
 * three-way "Save / Don't save / Cancel" choice that closing an edited document
 * needs. These render in the app's own style and resolve a promise instead.
 */

let host: HTMLDivElement | null = null
let root: Root | null = null

function mount(node: React.ReactNode): void {
  if (!host) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  root?.render(node)
}

function unmount(): void {
  root?.render(null)
}

interface Choice {
  label: string
  value: string
  variant?: 'primary' | 'danger'
}

function Dialog({
  title,
  message,
  detail,
  choices,
  onPick
}: {
  title: string
  message: string
  detail?: string
  choices: Choice[]
  onPick: (v: string) => void
}): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      data-mn-ignore
      onMouseDown={() => onPick(choices[choices.length - 1].value)}
    >
      <div className="modal confirm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        {detail && <p className="muted small">{detail}</p>}
        <div className="modal-actions">
          {choices.map((c) => (
            <button
              key={c.value}
              className={c.variant === 'primary' ? 'primary' : c.variant === 'danger' ? 'danger-btn' : ''}
              onClick={() => onPick(c.value)}
              autoFocus={c.variant === 'primary'}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ask(title: string, message: string, detail: string | undefined, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    const pick = (value: string): void => {
      unmount()
      resolve(value)
    }
    mount(<Dialog title={title} message={message} detail={detail} choices={choices} onPick={pick} />)
  })
}

/** Yes / No. Resolves true for yes. */
export async function confirmDialog(args: {
  title: string
  message: string
  detail?: string
}): Promise<boolean> {
  const answer = await ask(args.title, args.message, args.detail, [
    { label: 'No', value: 'no' },
    { label: 'Yes', value: 'yes', variant: 'primary' }
  ])
  return answer === 'yes'
}

/** Information, single acknowledgement. */
export async function messageDialog(args: {
  title: string
  message: string
  detail?: string
}): Promise<void> {
  await ask(args.title, args.message, args.detail, [{ label: 'OK', value: 'ok', variant: 'primary' }])
}

/** The three-way choice needed when discarding an edited document. */
export async function confirmUnsavedDialog(name: string): Promise<'save' | 'discard' | 'cancel'> {
  const answer = await ask(
    'Unsaved changes',
    `Do you want to save the changes you made to ${name}?`,
    "Your changes will be lost if you don't save them.",
    [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't save", value: 'discard', variant: 'danger' },
      { label: 'Save', value: 'save', variant: 'primary' }
    ]
  )
  return answer as 'save' | 'discard' | 'cancel'
}

/** Filename without directories, replacing the old main-process helper. */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
