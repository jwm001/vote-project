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
      borderRadius: '16px',
      padding: '2.5rem',
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      maxWidth: '500px',
      margin: '2rem auto'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '2rem', fontSize: '1.8rem' }}>登录</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>用户名</label>
          <input
            value={form.username}
            onChange={e => setForm({...form, username: e.target.value})}
            required
          />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>密码</label>
          <input
            type="password"
            value={form.password}
            onChange={e => setForm({...form, password: e.target.value})}
            required
          />
        </div>
        {error && <p style={{ color: '#e74c3c', marginBottom: '1rem' }}>{error}</p>}
        <button type="submit" style={{ width: '100%' }}>登录</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#666' }}>
        还没有账号？ <Link to="/register">立即注册</Link>
      </p>
    </div>
  );
}
