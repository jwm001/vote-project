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
      padding: '1.8rem 1.5rem',
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.25)',
      maxWidth: '700px',
      margin: '1rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '700' }}>创建投票</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.2rem' }}>
          <label>投票标题</label>
          <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <label>投票描述（可选）</label>
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.2rem' }}>
          <div>
            <label>开始时间</label>
            <input type="datetime-local" value={form.startAt} onChange={e => setForm({...form, startAt: e.target.value})} required />
          </div>
          <div>
            <label>结束时间</label>
            <input type="datetime-local" value={form.endAt} onChange={e => setForm({...form, endAt: e.target.value})} required />
          </div>
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: '500' }}>
            <input type="checkbox" checked={form.allowMultiple} onChange={e => setForm({...form, allowMultiple: e.target.checked})} style={{ width: 'auto' }} />
            允许多选
          </label>
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <label>投票选项</label>
          {form.options.map((opt, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <input value={opt} onChange={e => {
                const newOpts = [...form.options];
                newOpts[idx] = e.target.value;
                setForm({...form, options: newOpts});
              }} placeholder={`选项 ${idx + 1}`} required />
              {form.options.length > 2 && (
                <button type="button" onClick={() => removeOption(idx)} style={{ padding: '0.4em 0.8em', fontSize: '0.8em', background: '#e74c3c', boxShadow: 'none' }}>删除</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addOption} style={{ padding: '0.4em 0.8em', fontSize: '0.8em', background: 'white', color: '#667eea', border: '1.5px solid #667eea', boxShadow: 'none' }}>+ 添加选项</button>
        </div>
        {error && <p style={{ color: '#e74c3c', marginBottom: '0.8rem', fontSize: '0.85rem' }}>{error}</p>}
        <button type="submit" style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }}>创建投票</button>
      </form>
    </div>
  );
}
