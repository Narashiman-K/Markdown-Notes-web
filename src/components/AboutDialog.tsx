import { platform } from '../platform'
import logoMark from '../assets/logo-mark.png'
import { AUTHOR, LINKEDIN_URL, SIGNATURE } from '../lib/signature'
import { APP_DISPLAY_NAME, TAGLINE, REPO_URL, MS_STORE_URL } from '../shared/brand'

interface Props {
  onClose: () => void
}

export default function AboutDialog({ onClose }: Props): React.JSX.Element {
  const caps = platform.capabilities

  return (
    <div className="modal-backdrop" data-mn-ignore onMouseDown={onClose}>
      <div className="modal about-modal" onMouseDown={(e) => e.stopPropagation()} data-signature={SIGNATURE}>
        <div className="about-head">
          <img className="about-logo" src={logoMark} alt={APP_DISPLAY_NAME} draggable={false} />
          <div>
            <h2>{APP_DISPLAY_NAME}</h2>
            <p className="muted small">{TAGLINE}</p>
          </div>
        </div>

        <div className="about-body">
          <p>
            Created by <strong>{AUTHOR}</strong>
          </p>

          <p>
            Free to use for <strong>personal use</strong>. Not licensed for commercial purposes.
          </p>

          <p>
            Please do comment and give it <strong>5 stars</strong> if you like it. Thanks!
          </p>

          <p>
            Prefer a desktop app?{' '}
            <a
              href={MS_STORE_URL}
              onClick={(e) => {
                e.preventDefault()
                platform.openExternal(MS_STORE_URL)
              }}
            >
              Get it for Windows on the Microsoft Store
            </a>
          </p>

          <p>
            <a
              href={LINKEDIN_URL}
              onClick={(e) => {
                e.preventDefault()
                platform.openExternal(LINKEDIN_URL)
              }}
            >
              Narashiman Krishnamurthy | LinkedIn
            </a>
          </p>

          <p className="muted small">
            Your documents stay on this device. Cloud features are off until you enable them with your own
            API key.{' '}
            <a
              href={REPO_URL}
              onClick={(e) => {
                e.preventDefault()
                platform.openExternal(REPO_URL)
              }}
            >
              Source code
            </a>
          </p>

          <p className="muted small about-versions">
            {caps.native ? 'App' : 'Web'} ·{' '}
            {caps.fileSystemAccess ? 'Direct file access available' : 'Documents saved in this browser'}
            {caps.localAi ? '' : ' · Local AI unavailable on this device'}
          </p>
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
