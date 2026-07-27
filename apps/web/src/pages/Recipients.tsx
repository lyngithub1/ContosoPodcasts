import { useState } from 'react';
import { useStudio } from '../store/StudioContext';
import { Badge } from '../components/common/Badge';

export function Recipients() {
  const { recipients, distributionLists, addRecipient, createDistributionList } = useStudio();
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState('');
  const [external, setExternal] = useState(false);
  const [listName, setListName] = useState('');
  const [listPurpose, setListPurpose] = useState('');
  const [listMembers, setListMembers] = useState<string[]>([]);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Distribution</span>
          <h2 className="page-title">Recipients & lists</h2>
          <p className="page-sub">
            Reusable named lists with owner and purpose. External recipients are clearly marked and
            require Publisher approval before delivery. Addresses are never exposed cross-recipient.
          </p>
        </div>
      </div>

      <div className="ws-layout">
        <div className="ws-main stack">
          <section className="panel panel-pad stack">
            <h3>Distribution lists</h3>
            {distributionLists.map((l) => (
              <div key={l.id} className="segment">
                <div className="segment-head">
                  <strong>{l.name}</strong>
                  {l.containsExternal ? <Badge tone="warn">contains external</Badge> : <Badge tone="ok">internal only</Badge>}
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{l.recipientIds.length} recipient(s)</span>
                </div>
                <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>{l.purpose}</p>
                <div className="tag-row">
                  {l.recipientIds.map((rid) => {
                    const r = recipients.find((x) => x.id === rid);
                    return (
                      <span key={rid} className="tag">
                        {r?.displayName ?? rid}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          <section className="panel panel-pad stack">
            <h3>All recipients</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Identity</th>
                  <th>Organization</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>{r.displayName}</td>
                    <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.identity}</td>
                    <td>{r.organization ?? '—'}</td>
                    <td>{r.isExternal ? <Badge tone="warn">external</Badge> : <Badge tone="neutral">internal</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="inspector panel panel-pad stack">
          <h3 className="inspector-title">Add recipient</h3>
          <div className="field">
            <label htmlFor="rc-name">Name</label>
            <input id="rc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rc-id">Email / identity</label>
            <input id="rc-id" className="input" value={identity} onChange={(e) => setIdentity(e.target.value)} />
          </div>
          <label className="row" style={{ gap: 8, fontSize: 'var(--fs-sm)' }}>
            <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} /> External recipient
          </label>
          <button
            className="btn"
            disabled={!name.trim() || !identity.trim()}
            onClick={() => {
              addRecipient({ displayName: name.trim(), identity: identity.trim(), isExternal: external, organization: null });
              setName('');
              setIdentity('');
              setExternal(false);
            }}
          >
            Add recipient
          </button>

          <hr className="hr" />
          <h3 className="inspector-title">Create list</h3>
          <div className="field">
            <label htmlFor="ls-name">List name</label>
            <input id="ls-name" className="input" value={listName} onChange={(e) => setListName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ls-purpose">Purpose</label>
            <input id="ls-purpose" className="input" value={listPurpose} onChange={(e) => setListPurpose(e.target.value)} />
          </div>
          <div>
            <div className="eyebrow">Members</div>
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              {recipients.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8, fontSize: 'var(--fs-sm)' }}>
                  <input
                    type="checkbox"
                    checked={listMembers.includes(r.id)}
                    onChange={(e) => setListMembers((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                  />
                  <span>{r.displayName}</span>
                  {r.isExternal && <Badge tone="warn">external</Badge>}
                </label>
              ))}
            </div>
          </div>
          <button
            className="btn btn-primary"
            disabled={!listName.trim() || listMembers.length === 0}
            onClick={() => {
              createDistributionList(listName.trim(), listPurpose.trim() || 'Unspecified', listMembers);
              setListName('');
              setListPurpose('');
              setListMembers([]);
            }}
          >
            Create list
          </button>
        </aside>
      </div>
    </div>
  );
}
