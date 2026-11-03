import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Register() {
  const [form, setForm] = useState({ username: '', password: '', realName: '', idNumber: '' });
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const formData = new FormData();
    formData.append('username', form.username);
    formData.append('password', form.password);
    formData.append('realName', form.realName);
    formData.append('idNumber', form.idNumber);
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append('idCardImages', files[i]);
      }
    }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        alert('注册成功，请等待管理员审核');
        navigate('/login');
      } else {
        setError(data.error || '注册失败');
      }
    } catch (err) {
      setError('注册失败');
    }
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '2rem 1.6rem',
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.25)',
      maxWidth: '460px',
      margin: '1.5rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '2.2rem', marginBottom: '0.4rem' }}>📝</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.3rem' }}>实名认证注册</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>需提交真实信息并等待审核</p>
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.9rem' }}>
          <label>用户名 *</label>
          <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} placeholder="请输入用户名" required />
        </div>
        <div style={{ marginBottom: '0.9rem' }}>
          <label>密码 *</label>
          <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="请输入密码（至少 6 位）" minLength={6} required />
        </div>
        <div style={{ marginBottom: '0.9rem' }}>
          <label>真实姓名 *</label>
          <input value={form.realName} onChange={e => setForm({...form, realName: e.target.value})} placeholder="请输入真实姓名" required />
        </div>
        <div style={{ marginBottom: '0.9rem' }}>
          <label>身份证号 *</label>
          <input value={form.idNumber} onChange={e => setForm({...form, idNumber: e.target.value})} placeholder="请输入身份证号" required />
        </div>
        <div style={{ marginBottom: '1.2rem' }}>
          <label>身份证照片 *</label>
          <input type="file" multiple accept="image/*" onChange={e => setFiles(e.target.files)} required style={{ padding: '0.6em', background: '#f8f9fa' }} />
          <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.3rem' }}>可上传正反面等多张照片</p>
        </div>
        {error && <div style={{ padding: '0.6rem', background: '#fee', color: '#e74c3c', borderRadius: '8px', marginBottom: '0.8rem', fontSize: '0.85rem' }}>{error}</div>}
        <button type="submit" style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }}>注册</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: '1.2rem', color: '#666', fontSize: '0.85rem' }}>
        已有账号？ <Link to="/login" style={{ fontWeight: '600' }}>立即登录</Link>
      </p>
    </div>
  );
}
