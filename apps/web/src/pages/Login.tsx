import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        navigate('/votes');
        window.location.reload();
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('登录失败');
    }
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '2rem 1.6rem',
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.25)',
      maxWidth: '420px',
      margin: '2rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: '0.4rem' }}>🔐</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.3rem' }}>欢迎回来</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>登录您的账号</p>
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>用户名</label>
          <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="请输入用户名" required />
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <label>密码</label>
          <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="请输入密码" required />
        </div>
        {error && <div style={{ padding: '0.6rem', background: '#fee', color: '#e74c3c', borderRadius: '8px', marginBottom: '0.8rem', fontSize: '0.85rem' }}>{error}</div>}
        <button type="submit" style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }}>登录</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: '1.2rem', color: '#666', fontSize: '0.85rem' }}>
        还没有账号？ <Link to="/register" style={{ fontWeight: '600' }}>立即注册</Link>
      </p>
    </div>
  );
}
