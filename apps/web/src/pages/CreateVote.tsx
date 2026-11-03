import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CreateVote() {
  const [form, setForm] = useState({
    title: '',
    description: '',
    allowMultiple: false,
    startAt: '',
    endAt: '',
    options: ['', '']
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const addOption = () => {
    setForm({...form, options: [...form.options, '']});
  };

  const removeOption = (index: number) => {
    if (form.options.length > 2) {
      setForm({...form, options: form.options.filter((_, i) => i !== index)});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    const options = form.options.filter(o => o.trim());
    if (options.length < 2) {
      setError('至少需要2个选项');
      return;
    }
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, options })
      });
      const data = await res.json();
      if (res.ok) {
        navigate(`/vote/${data.vote.id}`);
      } else {
        setError(data.error || '创建失败');
      }
    } catch (err) {
      setError('创建失败');
    }
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '1.6rem 1.4rem',
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.25)',
      maxWidth: '650px',
      margin: '0.8rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '1.3rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>📝</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700' }}>创建新投票</h2>
        <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.3rem' }}>设置投票信息和选项</p>
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>投票标题 *</label>
          <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="请输入投票标题" required />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>投票描述</label>
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} placeholder="请输入投票描述（可选）" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '1rem' }}>
          <div>
            <label>开始时间 *</label>
            <input type="datetime-local" value={form.startAt} onChange={e => setForm({...form, startAt: e.target.value})} required />
          </div>
          <div>
            <label>结束时间 *</label>
            <input type="datetime-local" value={form.endAt} onChange={e => setForm({...form, endAt: e.target.value})} required />
          </div>
        </div>
        <div style={{ marginBottom: '1rem', padding: '0.7rem', background: '#f8f9ff', borderRadius: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: '500', marginBottom: 0 }}>
            <input type="checkbox" checked={form.allowMultiple} onChange={e => setForm({...form, allowMultiple: e.target.checked})} style={{ width: 'auto' }} />
            允许多选（用户可选择多个选项）
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>投票选项 *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {form.options.map((opt, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ minWidth: '20px', color: '#666', fontSize: '0.85rem' }}>{idx + 1}.</span>
                <input value={opt} onChange={e => {
                  const newOpts = [...form.options];
                  newOpts[idx] = e.target.value;
                  setForm({...form, options: newOpts});
                }} placeholder={`选项 ${idx + 1}`} required style={{ flex: 1 }} />
                {form.options.length > 2 && (
                  <button type="button" onClick={() => removeOption(idx)} style={{ padding: '0.4em 0.7em', fontSize: '0.75em', background: '#fee', color: '#e74c3c', border: '1px solid #fcc', boxShadow: 'none' }}>✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} style={{ marginTop: '0.5rem', padding: '0.4em 0.9em', fontSize: '0.8em', background: 'white', color: '#667eea', border: '1.5px solid #667eea', boxShadow: 'none' }}>+ 添加选项</button>
        </div>
        {error && <div style={{ padding: '0.6rem', background: '#fee', color: '#e74c3c', borderRadius: '8px', marginBottom: '0.8rem', fontSize: '0.85rem' }}>{error}</div>}
        <button type="submit" style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }}>创建投票</button>
      </form>
    </div>
  );
}
