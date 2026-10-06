import { useState } from 'react';
import { IonButton } from '@ionic/react';
import { download, type Backup } from './model';
import { mergeBackup } from './sync';
import type { PrivateSync } from './useSync';

export function syncLabel(sync: PrivateSync) {
  if (!sync.state.owner) return 'Device only';
  return ({ local: 'Device only', loading: 'Loading private notes', synced: 'Private sync up to date', saving: 'Syncing notes', pending: 'Notes waiting to sync', error: 'Sync needs attention', conflict: 'Choose a version' })[sync.state.phase];
}
const exportData = (data: Backup, name = 'recovery') => download(`nash-after-dark-${name}.json`, JSON.stringify(data, null, 2), 'application/json');

export default function SyncSettings({ sync }: { sync: PrivateSync }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [create, setCreate] = useState(false); const [device, setDevice] = useState<Backup | null>(null);
  const [localMessage, setLocalMessage] = useState('');
  const { state, engine } = sync;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const okay = sync.recoveryMode ? await sync.updatePassword(password) : create ? await sync.signUp(email.trim(), password) : await sync.signIn(email.trim(), password);
    if (okay) setPassword('');
  };
  return <section className="settings-card sync-settings" aria-label="Private sync">
    <h2>Private sync</h2><p>Keep your visits, notes, favorites, saved nights, and search interests together on your phone and computer.</p>
    {sync.configState === 'loading' && <p role="status">Checking private sync… Device notes remain available.</p>}
    {sync.configState === 'missing' && <p className="muted">Private sync is not configured on this copy. You can keep using device notes and JSON backups.</p>}
    {sync.configState === 'error' && <div className="notice warning"><span>{sync.configMessage}</span><button onClick={sync.retryConfig}>Retry connection</button></div>}
    {sync.configState === 'ready' && (!sync.user || sync.recoveryMode) && <>
      <h3>{sync.recoveryMode ? 'Choose a new password' : create ? 'Create your private account' : 'Sign in'}</h3>
      <form onSubmit={submit}>
        {!sync.recoveryMode && <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
        <label>{sync.recoveryMode ? 'New password' : 'Password'}<input type="password" autoComplete={create || sync.recoveryMode ? 'new-password' : 'current-password'} required minLength={create || sync.recoveryMode ? 8 : undefined} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <div className="sync-actions"><IonButton type="submit" disabled={sync.authBusy}>{sync.recoveryMode ? 'Save new password' : create ? 'Create account' : 'Sign in'}</IonButton>{!sync.recoveryMode && <IonButton type="button" fill="outline" disabled={sync.authBusy} onClick={() => { setCreate(!create); setPassword(''); }}>{create ? 'Use existing account' : 'Create account instead'}</IonButton>}</div>
      </form>
      {!sync.recoveryMode && <button className="text-button" disabled={sync.authBusy || !email.includes('@')} onClick={() => void sync.resetEmail(email.trim())}>Email me a password-reset link</button>}
      {create && <p className="footnote">Use the project owner’s approved email. Account confirmation and reset emails are limited by the current built-in mailer. Other addresses need custom email delivery configured first.</p>}
      <p className="footnote">Signing in loads that account’s cloud data. It does not upload device-only notes or search interests. You can choose to merge those after signing in.</p>
    </>}
    {sync.user && <>
      <p>Signed in as <strong>{sync.user.email || 'your private account'}</strong></p>
      <p className="sync-message" role="status">{syncLabel(sync)}{state.dirty && '. Your unsynced draft is saved on this device.'}</p>
      {state.message && <p className="sync-message" role="alert">{state.message}</p>}
      <div className="sync-actions"><IonButton fill="outline" disabled={state.phase === 'loading' || state.phase === 'saving'} onClick={engine.refresh}>Refresh / retry sync</IonButton><IonButton fill="clear" disabled={sync.authBusy} onClick={() => void sync.signOut()}>Sign out</IonButton></div>
      {state.conflict && <div className="sync-conflict"><h3>Two versions need your choice</h3><p>Your draft and the cloud version are both preserved. Replacing the cloud version also keeps a local recovery copy of that version.</p><div className="sync-actions"><IonButton fill="outline" onClick={() => exportData(state.data, 'my-draft')}>Download my draft</IonButton><IonButton fill="outline" onClick={() => exportData(state.conflict!.data, 'cloud-version')}>Download cloud version</IonButton><IonButton onClick={engine.useCloud}>Use cloud version</IonButton><IonButton fill="outline" onClick={engine.keepDraft}>Replace cloud with my draft</IonButton></div></div>}
      <details><summary>Bring device-only notes and search interests into this account</summary><p>This is an explicit upload. Matching places and search interests will use this device’s values; other account records and saved nights are kept.</p><IonButton fill="outline" disabled={!state.ready || !!state.conflict} onClick={() => { try { setDevice(engine.deviceBackup()); setLocalMessage(''); } catch (error) { setLocalMessage((error as Error).message); } }}>Review device notes</IonButton>{device && <div className="import-preview"><p>{Object.keys(device.history).length} place records, {device.savedEventIds.length} saved nights, and {Object.keys(device.searchInterests || {}).length} search interests will merge into <strong>{sync.user.email}</strong>.</p><IonButton disabled={!state.ready || !!state.conflict} onClick={() => { if (engine.mutate(current => mergeBackup(current, device))) { setDevice(null); setLocalMessage('Device data merged; waiting for sync confirmation.'); } }}>Upload and merge this device</IonButton><IonButton fill="clear" onClick={() => setDevice(null)}>Cancel</IonButton></div>}</details>
      {state.archives.length > 0 && <details><summary>Preserved versions ({state.archives.length})</summary><p>These recovery copies stay in this browser. Download them before clearing browser data.</p>{state.archives.map((archive, i) => <button className="text-button" key={archive.key} onClick={() => exportData(archive.data, `preserved-${i + 1}`)}>Download version from {new Date(archive.createdAt).toLocaleString()}</button>)}</details>}
      <p className="footnote">Cloud data is private to this account. Unsynced drafts are stored separately by account on this device. Sign out before sharing the device.</p>
    </>}
    {(sync.authMessage || localMessage) && <p className="sync-message" role="status">{localMessage || sync.authMessage}</p>}
  </section>;
}
