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
      borderRadius: '16px',
      padding: '2.5rem',
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      maxWidth: '500px',
      margin: '2rem auto'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '2rem', fontSize: '1.8rem' }}>注册（需实名认证）</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>用户名</label>
          <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} required />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>密码</label>
          <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>真实姓名</label>
          <input value={form.realName} onChange={e => setForm({...form, realName: e.target.value})} required />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>身份证号</label>
          <input value={form.idNumber} onChange={e => setForm({...form, idNumber: e.target.value})} required />
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          <label>身份证照片（可上传多张）</label>
          <input type="file" multiple accept="image/*" onChange={e => setFiles(e.target.files)} required />
        </div>
        {error && <p style={{ color: '#e74c3c', marginBottom: '1rem' }}>{error}</p>}
        <button type="submit" style={{ width: '100%' }}>注册</button>
      </form>
      <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#666' }}>
        已有账号？ <Link to="/login">立即登录</Link>
      </p>
    </div>
  );
}
